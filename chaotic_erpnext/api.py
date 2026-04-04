import frappe
import requests
import json
from frappe.auth import LoginManager
from frappe import _

@frappe.whitelist(allow_guest=True)
def chaotic_verify(login, proof, attestation_quote, nonce, timestamp):
    """
    The verification proxy for Frappe. 
    Receives ZKP + TPM data from the browser and forwards it to the 
    Chaotic FastAPI (api_server.py) for final validation.
    """
    
    # 1. Prepare payload for the Chaotic FastAPI
    base_url = frappe.conf.get("chaotic_api_url", "http://localhost:8000")
    fastapi_url = f"{base_url.rstrip('/')}/api/auth/verify"
    
    payload = {
        "user_id": login,
        "proof": proof,
        "attestation": attestation_quote,
        "nonce": nonce,
        "timestamp": timestamp
    }
    
    try:
        response = requests.post(fastapi_url, json=payload, timeout=10)
        result = response.json()
        
        if result.get("success"):
            # SUCCESS: Hardware + ZK proof validated.
            login_manager = LoginManager()
            login_manager.user = login
            login_manager.post_login()
            
            return {"success": True, "message": "Hardware Authentication Successful."}
        else:
            frappe.throw(_("Hardware Authentication Failed: {0}").format(result.get("error", "Invalid Proof")))

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Chaotic Auth Error")
        return {"success": False, "message": f"Connection to Chaotic Authority failed: {str(e)}"}

@frappe.whitelist()
def chaotic_register_device(device_id):
    """
    Enrolls the current logged-in user's hardware device.
    Links the TPM identity to the Frappe User account.
    """
    user = frappe.session.user
    if user == "Guest":
        frappe.throw(_("You must be logged in to register a device."))

    # Aligned with api_server.py:252 (/api/devices/enroll)
    base_url = frappe.conf.get("chaotic_api_url", "http://localhost:8000")
    fastapi_url = f"{base_url.rstrip('/')}/api/devices/enroll"
    
    payload = {
        "user_id": user,
        "device_id": device_id
    }
    
    try:
        response = requests.post(fastapi_url, json=payload, timeout=10)
        result = response.json()
        
        if result.get("success"):
            # Store the hardware ID on the User profile
            frappe.db.set_value("User", user, "chaotic_device_id", device_id)
            frappe.db.commit()
            return {"success": True, "message": "Device Registered Successfully!"}
        else:
            frappe.throw(_("Device Registration Failed: {0}").format(result.get("error", "Invalid Hardware")))

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Chaotic Registration Error")
        return {"success": False, "message": str(e)}

@frappe.whitelist(allow_guest=True)
def chaotic_signup(full_name, email, device_id, g0, Y):
    """
    Creates a new Frappe User and simultaneously enrolls their hardware
    with the local Chaotic Authority via S2S handshake.
    """
    # 1. Create the Frappe User if they don't exist
    if not frappe.db.exists("User", email):
        user = frappe.get_doc({
            "doctype": "User",
            "email": email,
            "first_name": full_name,
            "send_welcome_email": 0,
            "enabled": 1,
            "user_type": "System User",
            "roles": [{"role": "System User"}]
        })
        user.insert(ignore_permissions=True)
    
    # 2. Bind the Hardware ID and ZK Commitments to the User Doc
    frappe.db.set_value("User", email, {
        "chaotic_device_id": device_id,
        "chaotic_g0": g0,
        "chaotic_y": Y
    })
    frappe.db.commit()

    # 3. Synchronize with FastAPI Authority (Server-to-Server)
    base_url = frappe.conf.get("chaotic_api_url", "http://localhost:8000")
    
    try:
        # A. Register the ZK Commitment
        reg_response = requests.post(f"{base_url.rstrip('/')}/api/register", json={
            "hr_id": email,
            "g0": g0,
            "Y": Y
        }, timeout=10)
        
        # B. Enroll the Hardware
        enroll_response = requests.post(f"{base_url.rstrip('/')}/api/devices/enroll", json={
            "user_id": email,
            "device_id": device_id
        }, timeout=10)
        
        if reg_response.status_code == 200 and enroll_response.status_code == 200:
            return {"success": True, "message": f"Synchronized account created for {email}"}
        else:
            return {"success": False, "message": "Backend synchronization failed."}
            
    except Exception as e:
        return {"success": False, "message": f"Connection to Chaotic Hub failed: {str(e)}"}

@frappe.whitelist(allow_guest=True)
def chaotic_discover(device_id):
    """
    Returns the user account linked to a specific device ID.
    Used by the Discovery Hub to show the 'Account Card'.
    """
    user = frappe.db.get_value("User", {"chaotic_device_id": device_id}, ["name", "full_name"], as_dict=True)
    if user:
        return {"success": True, "user_id": user.name, "full_name": user.full_name}
    return {"success": False, "message": "Device not recognized"}

def ensure_custom_fields():
    """
    Programmatically ensures the chaotic_device_id field exists on the User DocType.
    Replaces the unreliable JSON fixtures during site migration.
    """
    if not frappe.db.has_column("User", "chaotic_device_id"):
        from frappe.custom.doctype.custom_field.custom_field import create_custom_field
        create_custom_field("User", {
            "fieldname": "chaotic_device_id",
            "label": "Chaotic Device ID",
            "fieldtype": "Data",
            "insert_after": "email",
            "read_only": 1,
            "no_copy": 1,
            "hidden": 0
        })
        frappe.db.commit()

    if not frappe.db.has_column("User", "chaotic_g0"):
        from frappe.custom.doctype.custom_field.custom_field import create_custom_field
        create_custom_field("User", {
            "fieldname": "chaotic_g0",
            "label": "Chaotic G0 (Commitment Token)",
            "fieldtype": "Data",
            "insert_after": "chaotic_device_id",
            "read_only": 1,
            "hidden": 1
        })
        frappe.db.commit()

    if not frappe.db.has_column("User", "chaotic_y"):
        from frappe.custom.doctype.custom_field.custom_field import create_custom_field
        create_custom_field("User", {
            "fieldname": "chaotic_y",
            "label": "Chaotic Y (Public Commitment)",
            "fieldtype": "Data",
            "insert_after": "chaotic_g0",
            "read_only": 1,
            "hidden": 1
        })
        frappe.db.commit()
