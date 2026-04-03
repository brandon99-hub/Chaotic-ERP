/**
 * Chaotic Hardware Login - Frappe/ERPNext Client
 * Injects a 'Login with Hardware' button into the standard Frappe Login page
 * and handles hardware enrollment in the User profile.
 */

// 1. UNIVERSAL HANDLER (Handles Login Page Injection)
document.addEventListener('DOMContentLoaded', function() {
    if (window.location.pathname.startsWith('/login')) {
        console.log("[Chaotic] Login page detected");
        injectChaoticLoginButton();
    }
});

// 2. DESK HANDLER (The "Frappe Way" to add buttons to forms)
if (typeof frappe !== "undefined") {
    frappe.ui.form.on('User', {
        refresh: function(frm) {
            // Only show button on the user's OWN profile
            if (frm.doc.name === frappe.session.user && !frm.is_new()) {
                frm.add_custom_button(__('Register This Hardware'), function() {
                    handleHardwareEnroll();
                }).addClass('btn-primary').css({'background': '#1a1a2e', 'color': 'white'});
            }
        }
    });
}

function injectChaoticLoginButton() {
    const loginForm = document.querySelector('.form-signin');
    if (!loginForm) return;

    if (document.getElementById('chaotic-hardware-login')) return;

    const chaoticBtn = document.createElement('div');
    chaoticBtn.innerHTML = `
        <div class="form-group text-center" style="margin-top: 15px;">
            <div class="divider" style="margin: 10px 0; border-bottom: 1px solid #ddd; text-align: center;">
                <span style="background: white; padding: 0 10px; color: #888;">OR</span>
            </div>
            <button type="button" id="chaotic-hardware-login" class="btn btn-default btn-block btn-login" style="background: #1a1a2e; color: white;">
                Login with Secure Hardware
            </button>
            <p id="chaotic-status" style="margin-top: 10px; font-size: 12px; color: #555;"></p>
        </div>
    `;

    const forgotPassword = loginForm.querySelector('.forgot-password-link');
    forgotPassword ? forgotPassword.before(chaoticBtn) : loginForm.appendChild(chaoticBtn);

    document.getElementById('chaotic-hardware-login').addEventListener('click', handleHardwareLogin);
}

async function handleHardwareLogin() {
    const status = document.getElementById('chaotic-status');
    const userLoginElem = (document.getElementById('login_email') || document.getElementById('login_id'));
    const userLogin = userLoginElem ? userLoginElem.value : "";

    if (!userLogin) {
        frappe.msgprint(__('Please enter your Email/Username.'));
        return;
    }

    try {
        status.innerText = "Connecting to Hardware...";
        const hardwareData = await callChaoticHardwareBridge(userLogin);
        
        status.innerText = "Generating ZK Proof...";
        const zkpData = await generateZkProof(hardwareData);

        const response = await frappe.call({
            method: "chaotic_verify",
            args: {
                login: userLogin,
                proof: JSON.stringify(zkpData.proof),
                attestation_quote: hardwareData.quote,
                nonce: zkpData.publicSignals[0],
                timestamp: Date.now()
            }
        });

        if (response.message && response.message.success) {
            window.location.href = "/app";
        }
    } catch (err) {
        status.innerHTML = `<span style="color: red;">✘ Error: ${err.message}</span>`;
    }
}

async function handleHardwareEnroll() {
    try {
        frappe.show_alert({message:__("Initializing Hardware Enrollment..."), indicator:'blue'});
        
        // 1. Get attestation from TPM
        const hardwareData = await callChaoticHardwareBridge(frappe.session.user);
        
        // 2. Register with Frappe Backend
        const response = await frappe.call({
            method: "chaotic_register_device",
            args: {
                device_id: "HW_DEVICE_ID_" + Date.now() // Generated from TPM
            }
        });

        if (response.message && response.message.success) {
            frappe.msgprint({
                title: __('Success'),
                indicator: 'green',
                message: __('This device is now linked to your account. You can now use "Hardware Login" next time.')
            });
        }
    } catch (err) {
        frappe.msgprint(__('Registration Failed: ') + err.message);
    }
}

async function callChaoticHardwareBridge(user) {
    // Placeholder for actual browser-to-TPM bridge (WebAuthn or LocalAgent)
    return { quote: "TPM_QUOTE_" + Date.now(), nonce: "NONCE_" + Math.random() };
}

async function generateZkProof(input) {
    // Placeholder for snarkjs generation
    return { proof: {}, publicSignals: [input.nonce] };
}
