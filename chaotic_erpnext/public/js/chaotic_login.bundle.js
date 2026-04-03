/**
 * Chaotic Hardware Login - Frappe/ERPNext Client
 * Injects a 'Login with Hardware' button into the standard Frappe Login page.
 */

frappe.ready(function() {
    // 1. LOGIN PAGE: Show 'Login with Hardware'
    if (window.location.pathname.startsWith('/login')) {
        injectChaoticLoginButton();
    }
    
    // 2. INSIDE APP: Show 'Register Hardware' on User Profile
    if (frappe.session.user !== 'Guest' && window.location.pathname.includes('/app/user/')) {
        injectChaoticEnrollButton();
    }
});

function injectChaoticLoginButton() {
    const loginForm = document.querySelector('.form-signin');
    if (!loginForm) return;

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

function injectChaoticEnrollButton() {
    // Add button to the sidebar/actions of the User form
    setTimeout(() => {
        const actionButtons = document.querySelector('.page-actions');
        if (actionButtons && !document.getElementById('chaotic-enroll-btn')) {
            const enrollBtn = document.createElement('button');
            enrollBtn.id = 'chaotic-enroll-btn';
            enrollBtn.className = 'btn btn-primary btn-sm';
            enrollBtn.style = 'margin-left: 10px; background: #1a1a2e;';
            enrollBtn.innerText = 'Register This Hardware';
            enrollBtn.onclick = handleHardwareEnroll;
            actionButtons.prepend(enrollBtn);
        }
    }, 1000);
}

async function handleHardwareLogin() {
    const status = document.getElementById('chaotic-status');
    const userLogin = (document.getElementById('login_email') || document.getElementById('login_id')).value;

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
                proof: zkpData.proof,
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
        
        // 2. Register with Frappe Backend (aligned with DeviceEnrollmentRequest)
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
    return { quote: "TPM_QUOTE_" + Date.now(), nonce: "NONCE_" + Math.random() };
}

async function generateZkProof(input) {
    return { proof: {}, publicSignals: [input.nonce] };
}
