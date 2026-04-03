app_name = "chaotic_erpnext"
app_title = "Chaotic Hardware Authentication"
app_publisher = "Chaotic Team"
app_description = "zkSNARK + TPM Hardware Attestation for ERPNext"
app_email = "admin@example.com"
app_license = "mit"

# Correct way to include JS on all website pages (including /login)
app_include_js = "/assets/chaotic_erpnext/js/chaotic_login.js"
web_include_js = "/assets/chaotic_erpnext/js/chaotic_login.js"

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
