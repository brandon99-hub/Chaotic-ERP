import frappe
import requests
import json
from frappe.auth import LoginManager
from frappe import _

@frappe.whitelist(allow_guest=True)
def chaotic_proxy(endpoint, method="GET", data=None):
    """Generic internal proxy with ngrok bypass and better diagnostics."""
    base_url = frappe.conf.get("chaotic_api_url", "http://localhost:8088")
    url = f"{base_url.rstrip('/')}{endpoint}"
    
    headers = {
        "ngrok-skip-browser-warning": "69420", # Bypass ngrok intermediary page
        "Content-Type": "application/json"
    }
    
    try:
        if method == "POST":
            response = requests.post(url, json=data, headers=headers, timeout=15)
        else:
            response = requests.get(url, params=data, headers=headers, timeout=15)
        
        # Check for non-JSON responses (e.g. ngrok warning pages)
        try:
            return response.json()
        except ValueError:
            # Show the first 200 chars of the HTML to help the user identify the issue
            error_preview = response.text[:200].replace('\n', ' ')
            frappe.throw(_("Chaotic Bridge [HTML Error {0}]: {1}...").format(response.status_code, error_preview))

    except requests.exceptions.ConnectionError:
        frappe.throw(_("Chaotic Bridge: Could not reach {0}. Check if your local server and ngrok are running.").format(base_url))
    except Exception as e:
        frappe.throw(_("Chaotic Bridge Internal Error: {0}").format(str(e)))

# --- WHITELISTED PROXIES (Used by Javascript) ---

@frappe.whitelist(allow_guest=True)
def get_chaotic_g0():
    return chaotic_proxy("/api/register/g0", "GET")

@frappe.whitelist(allow_guest=True)
def chaotic_get_challenge(user_id, device_id):
    return chaotic_proxy("/api/auth/challenge", "POST", {"user_id": user_id, "device_id": device_id})

@frappe.whitelist(allow_guest=True)
def chaotic_get_user_devices(user_id):
    return chaotic_proxy(f"/api/devices/user/{user_id}", "GET")

@frappe.whitelist(allow_guest=True)
def chaotic_get_device_info(device_id):
    return chaotic_proxy(f"/api/devices/{device_id}", "GET")

@frappe.whitelist(allow_guest=True)
def chaotic_rename_device(device_id, new_alias):
    return chaotic_proxy("/api/devices/rename", "POST", {"device_id": device_id, "new_alias": new_alias})

@frappe.whitelist(allow_guest=True)
def chaotic_initiate_remote(user_id, device_id, site_origin):
    return chaotic_proxy("/api/auth/initiate_remote", "POST", {
        "user_id": user_id, 
        "device_id": device_id, 
        "site_origin": site_origin
    })

@frappe.whitelist(allow_guest=True)
def chaotic_poll_remote(challenge_id):
    return chaotic_proxy(f"/api/auth/poll_remote/{challenge_id}", "GET")

@frappe.whitelist(allow_guest=True)
def chaotic_signup(full_name, email, device_id, g0, Y, password=None):
    """Refactored signup that uses the bridge and supports Dual-Mode login."""
    # 1. Register with Local Authority via Bridge
    authority_res = chaotic_proxy("/api/register", "POST", {
        "hr_id": email,
        "g0": g0,
        "Y": Y
    })
    
    if not authority_res.get("success"):
        return {"success": False, "message": authority_res.get("detail", "Authority Registration Failed")}

    # 2. Create Frappe User
    if not frappe.db.exists("User", email):
        user = frappe.get_doc({
            "doctype": "User",
            "email": email,
            "first_name": full_name,
            "send_welcome_email": 0,
            "chaotic_g0": g0,
            "chaotic_y": Y,
            "enabled": 1
        })
        
        # Mirror password if provided (Enables standard Frappe form login)
        if password:
            user.set_password(password)
            
        user.insert(ignore_permissions=True)
        frappe.db.commit() # Force save for immediate login availability
    
    return {"success": True, "message": "Identity Synchronized"}

@frappe.whitelist(allow_guest=True)
def chaotic_verify(login, proof, attestation_quote, nonce, timestamp):
    """Refactored verification that uses the bridge."""
    authority_res = chaotic_proxy("/api/auth/verify", "POST", {
        "user_id": login,
        "device_id": "AUTO", # Authority can infer from public signals/attestation
        "proof": json.loads(proof) if isinstance(proof, str) else proof,
        "attestation": attestation_quote,
        "nonce": nonce,
        "timestamp": timestamp
    })

    if authority_res.get("success"):
        frappe.local.login_manager = LoginManager()
        frappe.local.login_manager.run_post_login_hooks = True
        frappe.local.login_manager.login_as(login)
        return {"success": True, "message": "Authenticated"}
    
    return {"success": False, "message": "Verification Failed"}

@frappe.whitelist(allow_guest=True)
def chaotic_discover(device_id):
    """Quickly check if this device is recognized by the local authority."""
    try:
        device_info = chaotic_proxy(f"/api/devices/{device_id}", "GET")
        if device_info and device_info.get("user_id"):
            return {
                "success": True, 
                "user_id": device_info["user_id"],
                "full_name": device_info.get("machine_alias", "Recognized Machine")
            }
    except:
        pass
    return {"success": False}

@frappe.whitelist()
def ensure_custom_fields():
    """Self-healing: Ensures User DocType has ZK fields."""
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
    create_custom_fields({
        "User": [
            {"fieldname": "chaotic_g0", "label": "Chaotic G0 Seed", "fieldtype": "Data", "insert_after": "email"},
            {"fieldname": "chaotic_y", "label": "Chaotic Y Commitment", "fieldtype": "Data", "insert_after": "chaotic_g0"}
        ]
    })
