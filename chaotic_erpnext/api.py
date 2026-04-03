import frappe
import requests
import json
from frappe.auth import LoginManager

@frappe.whitelist(allow_guest=True)
def chaotic_verify(login, proof, attestation_quote, nonce, timestamp):
    """
    The verification proxy for Frappe. 
    Receives ZKP + TPM data from the browser and forwards it to the 
    Chaotic FastAPI (api_server.py) for final validation.
    """
    
    # 1. Prepare payload for the Chaotic FastAPI
    fastapi_url = frappe.conf.get("chaotic_api_url", "http://localhost:8000/api/auth/verify")
    
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
def chaotic_register_device(attestation_quote, public_key):
    """
    Enrolls the current logged-in user's hardware device.
    Links the TPM identity to the Frappe User account.
    """
    user = frappe.session.user
    if user == "Guest":
        frappe.throw(_("You must be logged in to register a device."))

    # Verify and map on the FastAPI backend
    fastapi_url = frappe.conf.get("chaotic_api_url", "http://localhost:8000/api/auth/register")
    
    payload = {
        "user_id": user,
        "attestation": attestation_quote,
        "public_key": public_key
    }
    
    try:
        response = requests.post(fastapi_url, json=payload, timeout=10)
        result = response.json()
        
        if result.get("success"):
            # Store the hardware ID on the User profile (Custom Field)
            frappe.db.set_value("User", user, "chaotic_device_id", result.get("device_id"))
            frappe.db.commit()
            return {"success": True, "message": "Device Registered Successfully!"}
        else:
            frappe.throw(_("Device Registration Failed: {0}").format(result.get("error", "Invalid Hardware")))

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Chaotic Registration Error")
        return {"success": False, "message": str(e)}
