/**
 * Chaotic Hardware Login - Frappe/ERPNext Client
 * Injects a 'Login with Hardware' button into the standard Frappe Login page.
 */

frappe.ready(function() {
    // 1. Only run on the login page
    if (window.location.pathname.startsWith('/login')) {
        injectChaoticButton();
    }
});

function injectChaoticButton() {
    // 2. Find the default login form
    const loginForm = document.querySelector('.form-signin');
    if (!loginForm) return;

    // 3. Create the 'Login with Hardware' button
    const chaoticBtn = document.createElement('div');
    chaoticBtn.innerHTML = `
        <div class="form-group text-center" style="margin-top: 15px;">
            <div class="divider" style="margin: 10px 0; border-bottom: 1px solid #ddd; text-align: center;">
                <span style="background: white; padding: 0 10px; color: #888;">OR</span>
            </div>
            <button type="button" id="chaotic-hardware-login" class="btn btn-default btn-block btn-login" style="background: #1a1a2e; color: white;">
                <img src="/assets/chaotic_erpnext/images/tpm_icon.png" style="width: 20px; margin-right: 8px;" onerror="this.style.display='none'"/>
                Login with Secure Hardware
            </button>
            <p id="chaotic-status" style="margin-top: 10px; font-size: 12px; color: #555;"></p>
        </div>
    `;

    // 4. Inject it before the 'Forgot Password' link
    const forgotPassword = loginForm.querySelector('.forgot-password-link');
    if (forgotPassword) {
        forgotPassword.before(chaoticBtn);
    } else {
        loginForm.appendChild(chaoticBtn);
    }

    // 5. Connect the button event
    document.getElementById('chaotic-hardware-login').addEventListener('click', handleHardwareLogin);
}

async function handleHardwareLogin() {
    const status = document.getElementById('chaotic-status');
    const loginInput = document.getElementById('login_email') || document.getElementById('login_id');
    const userLogin = loginInput ? loginInput.value : '';

    if (!userLogin) {
        frappe.msgprint(__('Please enter your Email or Username first.'));
        return;
    }

    try {
        status.innerText = "Connecting to Hardware (TPM 2.0)...";
        
        // 1. CALL THE TPM (Via the local Chaotic Bridge)
        // This is where we get the attestation quote + nonce from the TPM
        const hardwareData = await callChaoticHardwareBridge(userLogin);
        
        status.innerText = "Generating zkSNARK Zero-Knowledge Proof...";
        
        // 2. GENERATE THE ZK PROOF
        // We use snarkjs to prove we have the private key corresponding to the device
        // without sending the key itself.
        const zkpData = await generateZkProof(hardwareData);

        status.innerText = "Verifying with Chaotic Authority...";
        
        // 3. SEND TO FRAPPE BACKEND
        const response = await frappe.call({
            method: "chaotic_verify",
            args: {
                login: userLogin,
                proof: zkpData.proof,
                attestation_quote: hardwareData.quote,
                nonce: zkpData.publicSignals[0],
                timestamp: Date.now()
            }
        });

        if (response.message && response.message.success) {
            status.innerHTML = `<span style="color: green;">✔ Authentication Successful! Redirecting...</span>`;
            
            // 4. REDIRECT ON SUCCESS (Frappe Session is now active)
            setTimeout(() => {
                window.location.href = "/app";
            }, 1000);
        }

    } catch (err) {
        console.error("Chaotic Error:", err);
        status.innerHTML = `<span style="color: red;">✘ Error: ${err.message || 'Hardware Check Failed'}</span>`;
    }
}

/**
 * Placeholder for the local TPM communication (mirroring Odoo's JS)
 */
async function callChaoticHardwareBridge(user) {
    // In production, this talks to a local agent or uses WebAuthn extensions
    return {
        quote: "Hardware_TPM_Attestation_String_v1.0",
        nonce: Math.random().toString(36).substring(7)
    };
}

/**
 * Placeholder for snarkjs proof generation (mirroring Odoo's JS)
 */
async function generateZkProof(input) {
    // We would use the pre-compiled circuits from the 'circuits/' folder
    return {
        proof: { pi_a: [], pi_b: [], pi_c: [] },
        publicSignals: [input.nonce]
    };
}
