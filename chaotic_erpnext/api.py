import frappe
import requests
import json
import time # Use standard Python time for reliability
from frappe.auth import LoginManager
from frappe import _

@frappe.whitelist(allow_guest=True)
def chaotic_proxy(endpoint, method="GET", data=None):
    """Generic internal proxy with ngrok bypass and hardened logging."""
    try:
        # Use str() casting to prevent TypeError on None
        base_url = str(frappe.conf.get("chaotic_api_url") or "http://localhost:8088")
        safe_endpoint = str(endpoint or "")
        url = f"{base_url.rstrip('/')}{safe_endpoint}"
        
        headers = {
            "ngrok-skip-browser-warning": "69420",
            "Content-Type": "application/json"
        }
        
        if method == "POST":
            response = requests.post(url, json=data, headers=headers, timeout=15)
        else:
            response = requests.get(url, params=data, headers=headers, timeout=15)
        
        try:
            return response.json()
        except ValueError:
            error_preview = (response.text or "")[:200].replace('\n', ' ')
            frappe.log_error(f"Chaotic Bridge [HTML {response.status_code}]: {error_preview}", "Chaotic Bridge Error")
            return {"success": False, "message": f"Bridge Returned HTML {response.status_code}"}

    except Exception:
        frappe.log_error(frappe.get_traceback(), "Chaotic Bridge Internal Failure")
        raise

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
def chaotic_get_attestation(user_id, device_id, nonce, srs_id="default_srs_v1"):
    return chaotic_proxy("/api/devices/attest", "POST", {
        "user_id": user_id, 
        "device_id": device_id, 
        "nonce": str(nonce),
        "timestamp": int(time.time()),
        "srs_id": srs_id
    })

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
    """Refactored signup that uses the bridge."""
    # 1. Register with Local Authority via Bridge
    authority_res = chaotic_proxy("/api/register", "POST", {
        "hr_id": email,
        "g0": g0,
        "Y": Y,
        "device_id": device_id
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
        if password:
            user.set_password(password)
        user.insert(ignore_permissions=True)
        frappe.db.commit()
    
    return {"success": True, "message": "Identity Synchronized"}

@frappe.whitelist(allow_guest=True)
def chaotic_verify(login, proof, attestation_quote, nonce, timestamp, public_signals=None):
    """Refactored verification that uses the bridge with hardened types."""
    authority_res = chaotic_proxy("/api/auth/verify", "POST", {
        "user_id": login,
        "device_id": "AUTO",
        "proof": json.loads(proof) if isinstance(proof, str) else proof,
        "attestation": attestation_quote,
        "nonce": int(nonce) if nonce else 0,
        "timestamp": int(timestamp) if timestamp else 0,
        "public_signals": public_signals or []
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
