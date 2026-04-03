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
    # This URL must be accessible to your Frappe Cloud site
    # Use ngrok or a public IP for development
    fastapi_url = frappe.conf.get("chaotic_api_url", "http://localhost:8000/api/auth/verify")
    
    payload = {
        "user_id": login,
        "proof": proof,
        "attestation": attestation_quote,
        "nonce": nonce,
        "timestamp": timestamp
    }
    
    try:
        # 2. Forward to the Chaotic Verification Authority
        response = requests.post(
            fastapi_url, 
            json=payload, 
            timeout=10
        )
        
        result = response.json()
        
        if result.get("success"):
            # 3. SUCCESS: The hardware + ZK proof is valid.
            # We now log the user into Frappe WITHOUT a password.
            
            # Use LoginManager to initialize the session for the given 'login' (email/username)
            login_manager = LoginManager()
            login_manager.user = login
            login_manager.post_login()
            
            # Return success to the frontend JS
            return {
                "success": True,
                "message": "Hardware Authentication Successful. Redirecting...",
                "sid": frappe.session.sid  # Return the session ID
            }
        else:
            # FAILURE: Invalid proof or device
            frappe.throw(_("Hardware Authentication Failed: {0}").format(result.get("error", "Unknown error")))

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Chaotic Auth Error")
        return {
            "success": False,
            "message": f"Connection to Chaotic Authority failed: {str(e)}"
        }
