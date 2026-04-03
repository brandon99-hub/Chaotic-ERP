app_name = "chaotic_erpnext"
app_title = "Chaotic Hardware Authentication"
app_publisher = "Chaotic Team"
app_description = "zkSNARK + TPM Hardware Attestation for ERPNext"
app_email = "admin@example.com"
app_license = "mit"

# Includes in <head>
# ------------------

# Add our custom login script globally (it will only activate on /login)
website_context = {
    "scripts": [
        "/assets/chaotic_erpnext/js/chaotic_login.bundle.js"
    ]
}

# Login Hooks
# -----------

# This whitelisted method will handle the verify request
# It's accessible via /api/method/chaotic_erpnext.api.chaotic_verify
whitelisted_methods = {
    "chaotic_verify": "chaotic_erpnext.api.chaotic_verify"
}

# Integration with User DocType
# ----------------------------

# We'll extend the 'User' document with our hardware fields via Custom Fields
# (Provisioned during install or manual setup)
