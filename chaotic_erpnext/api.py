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
    """Refactored signup that uses the bridge. Bulletproof against cloud validation errors."""
    # 1. Register with Local Authority via Bridge (the real source of truth)
    authority_res = chaotic_proxy("/api/register", "POST", {
        "hr_id": email,
        "g0": g0,
        "Y": Y,
        "device_id": device_id
    })

    if not authority_res.get("success"):
        return {"success": False, "message": authority_res.get("detail", "Authority Registration Failed")}

    # 2. Create or update Frappe User
    try:
        if not frappe.db.exists("User", email):
            # Split first/last name robustly
            name_parts = (full_name or "").strip().split(" ", 1)
            first_name = name_parts[0] or email.split("@")[0]
            last_name = name_parts[1] if len(name_parts) > 1 else ""

            user = frappe.get_doc({
                "doctype": "User",
                "email": email,
                "first_name": first_name,
                "last_name": last_name,
                "send_welcome_email": 0,
                "enabled": 1,
                "new_password": password or frappe.generate_hash(email, 16),
                "roles": [{"role": "System Manager"}]
            })
            user.insert(ignore_permissions=True)
            frappe.db.commit()
        
        # 3. Safely persist ZK commitment fields (non-blocking — custom fields may not exist yet)
        try:
            frappe.db.set_value("User", email, {
                "chaotic_g0": str(g0),
                "chaotic_y": str(Y)
            }, update_modified=False)
            frappe.db.commit()
        except Exception:
            # Custom fields not provisioned yet — authority still has the data, non-fatal
            frappe.log_error(frappe.get_traceback(), "Chaotic ZK Field Update (Non-Fatal)")

    except frappe.exceptions.DuplicateEntryError:
        # User already exists — treat as success (idempotent)
        pass
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Chaotic Signup - Frappe User Creation")
        return {"success": False, "message": "Account was registered on the authority but Frappe user creation failed. Check error logs."}

    return {"success": True, "message": "Identity Synchronized"}

@frappe.whitelist(allow_guest=True)
def chaotic_verify(login, proof, attestation_quote, nonce, timestamp, public_signals=None, device_id=None):
    """Bridge for hardware-attested verification. Force-parses JSON to avoid 422 errors."""
    
    # Force parse complex types
    try:
        if isinstance(proof, str): proof = json.loads(proof)
        if isinstance(public_signals, str): public_signals = json.loads(public_signals)
        if isinstance(attestation_quote, str): attestation_quote = json.loads(attestation_quote)
    except Exception:
        pass

    authority_res = chaotic_proxy("/api/auth/verify", "POST", {
        "user_id": login,
        "device_id": device_id or "AUTO",
        "proof": proof,
        "attestation": attestation_quote,
        "nonce": int(nonce) if nonce else 0,
        "timestamp": int(timestamp) if timestamp else 0,
        "public_signals": public_signals or []
    })

    # The backend verify returns {"success": True, ...} — NOT {"status": "success"}
    if authority_res.get("success") == True:
        try:
            # Compatible with all Frappe versions (v13, v14, v15)
            login_manager = LoginManager()
            login_manager.login_as(login)
        except Exception:
            # Fallback: directly set the session user (Frappe v15+ compatible)
            try:
                frappe.set_user(login)
            except Exception:
                frappe.log_error(frappe.get_traceback(), "Chaotic Login Session Error")
                return {"success": False, "message": "Session creation failed. Check Frappe error logs."}

        # Return pure JSON — Frappe handles the session cookie automatically
        frappe.response["type"] = "json"
        return {"success": True, "message": "Authenticated", "redirect": "/app"}

    return {"success": False, "message": authority_res.get("error", authority_res.get("message", "Verification Failed"))}

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
def get_chaotic_benchmarks():
    """Returns analytics and comparison data for the Benchmark Dashboard."""
    return chaotic_proxy("/api/benchmarks", "GET")

@frappe.whitelist()
def get_chaotic_health():
    """Bridge for the healthy status indicator on the dashboard."""
    return chaotic_proxy("/api/health", "GET")

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
