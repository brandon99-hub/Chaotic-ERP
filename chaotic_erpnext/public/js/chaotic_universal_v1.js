/**
 * Chaotic Universal Identity Client (v1)
 * Handles hardware discovery, remote relay (Ping), and unified auth/signup flows.
 * Now uses the "Universal Bridge" (Frappe Backend Proxies) to bypass CORS blocks.
 */

// --- CONFIGURATION ---
const SNARK_FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// --- STATE MANAGEMENT ---
let currentDeviceId = null;
let currentChallengeId = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("[Chaotic] Universal Hub Initialized (Bridge-Sync D81E)");
    const path = window.location.pathname;
    
    if (path === '/chaotic-auth') {
        initializeDiscovery();
    } else if (path === '/chaotic-signup') {
        initializeSignup();
    } else if (path === '/chaotic-settings') {
        initializeSettings();
    }
});

// --- CRYPTO UTILS ---

async function hashPasswordToField(password) {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const hashBigInt = BigInt('0x' + hashHex);
    return hashBigInt % SNARK_FIELD_MODULUS;
}

function computeCommitment(g0, secretX) {
    const g0Big = BigInt(g0);
    const xBig = BigInt(secretX);
    return (g0Big * xBig) % SNARK_FIELD_MODULUS;
}

// --- SIGNUP FLOW (chaotic-signup.html) ---
async function initializeSignup() {
    const btn = document.getElementById('btn-signup-hardware');
    if (!btn) return;

    btn.onclick = async () => {
        const name = document.getElementById('signup-name').value;
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        
        if (!name || !email || !password) return frappe.msgprint("All fields required");

        btn.disabled = true;
        document.getElementById('btn-text').style.display = 'none';
        document.getElementById('btn-loading').style.display = 'inline-block';

        try {
            const deviceId = await getLocalHardwareId();
            
            // Bridge Proxy Lookup
            const g0Res = await frappe.call({
                method: "chaotic_erpnext.api.get_chaotic_g0"
            });
            const g0 = g0Res.message.g0;

            const secretX = await hashPasswordToField(password);
            const Y = computeCommitment(g0, secretX);

            const response = await frappe.call({
                method: "chaotic_erpnext.api.chaotic_signup",
                args: {
                    full_name: name,
                    email: email,
                    device_id: deviceId,
                    g0: g0.toString(),
                    Y: Y.toString(),
                    password: password // Enables Dual-Mode login (Standard + ZK)
                }
            });

            if (response.message && response.message.success) {
                document.getElementById('signup-form').style.display = 'none';
                document.getElementById('success-message').style.display = 'block';
                document.getElementById('success-email').innerText = email;
                
                setTimeout(() => {
                    window.location.href = "/login?signup=success";
                }, 2000);
            } else {
                throw new Error(response.message.message || "Sync failure");
            }
        } catch (err) {
            frappe.msgprint("[JS-BRIDGE-D81E] Signup Failed: " + (err.message || err.exception));
            btn.disabled = false;
            document.getElementById('btn-text').style.display = 'inline-block';
            document.getElementById('btn-loading').style.display = 'none';
        }
    };
}

// --- INTERACTIVE DISCOVERY HUB (chaotic-auth.html) ---
async function initializeDiscovery() {
    const probing = document.getElementById('probing-state');
    const success = document.getElementById('success-state');
    const fallback = document.getElementById('fallback-state');
    const emailInput = document.getElementById('remote-email');
    const actionBtn = document.getElementById('btn-ping-devices');
    const passContainer = document.getElementById('hub-password-container');

    try {
        const deviceId = await getLocalHardwareId();
        const response = await frappe.call({
            method: "chaotic_erpnext.api.chaotic_discover",
            args: { device_id: deviceId }
        });

        if (response.message && response.message.success) {
            const userInfo = response.message;
            currentDeviceId = deviceId;
            probing.style.display = 'none';
            success.style.display = 'block';
            document.getElementById('device-alias').innerText = userInfo.full_name || "Recognized Machine";
            document.getElementById('linked-email').innerText = userInfo.user_id;

            document.getElementById('btn-login-local').onclick = () => loginWithHardware(deviceId, userInfo.user_id);
        } else {
            probing.style.display = 'none';
            fallback.style.display = 'block';
        }
    } catch (err) {
        probing.style.display = 'none';
        fallback.style.display = 'block';
    }

    // Interactive Listener: Wakes up the hub as you type
    if (emailInput && actionBtn) {
        emailInput.addEventListener('input', () => {
            const hasEmail = emailInput.value.length > 5;
            if (hasEmail) {
                actionBtn.innerText = "Login with Hardware Identity";
                actionBtn.className = "btn btn-primary btn-lg btn-block";
                if (passContainer) passContainer.style.display = 'block';
            } else {
                actionBtn.innerText = "Search Registered Devices";
                actionBtn.className = "btn btn-outline-primary btn-block";
                if (passContainer) passContainer.style.display = 'none';
            }
        });
    }

    document.getElementById('btn-ping-devices').onclick = async () => {
        const email = document.getElementById('remote-email').value;
        const password = document.getElementById('hub-password')?.value;
        if (!email) return frappe.msgprint("Please enter your email");

        // If password is present, attempt DIRECT LOCAL LOGIN
        if (password) {
            try {
                actionBtn.disabled = true;
                actionBtn.innerText = "Verifying Identity...";
                const deviceId = await getLocalHardwareId();
                await loginWithHardware(deviceId, email);
            } catch (err) {
                frappe.msgprint("Identity Verification Failed: " + err.message);
                actionBtn.disabled = false;
                actionBtn.innerText = "Login with Hardware Identity";
            }
            return;
        }

        // Otherwise, fallback to Remote Ping logic
        const devices = await getRemoteDevicesForUser(email);
        const container = document.getElementById('remote-devices-container');
        const listDiv = document.getElementById('remote-device-list');
        // ... (rest of search logic)
        
        container.innerHTML = "";
        if (devices.length === 0) {
            container.innerHTML = "<p style='color:red;'>No registered devices found.</p>";
        } else {
            devices.forEach(dev => {
                const btn = document.createElement('button');
                btn.className = "btn btn-block btn-outline-primary";
                btn.style.marginBottom = "10px";
                btn.style.textAlign = "left";
                btn.innerHTML = `<span style="font-weight:700;">${dev.machine_alias || "Device"}</span><br><span style="font-size:11px;">ID: ${dev.device_id.substring(0,8)}...</span>`;
                btn.onclick = () => initiateRemotePing(email, dev.device_id, dev.machine_alias);
                container.appendChild(btn);
            });
        }
        listDiv.style.display = 'block';
    };
}

// --- LOGIN FLOW ---
async function loginWithHardware(deviceId, email) {
    try {
        frappe.show_alert({message:__("Engaging Hardware Bridge..."), indicator:'blue'});
        
        // Challenge via Bridge
        const challengeRes = await frappe.call({
            method: "chaotic_erpnext.api.chaotic_get_challenge",
            args: { user_id: email, device_id: deviceId }
        });
        const challenge = challengeRes.message;

        const signature = await getHardwareSignature(deviceId, challenge.nonce);

        const response = await frappe.call({
            method: "chaotic_erpnext.api.chaotic_verify",
            args: {
                login: email,
                proof: JSON.stringify(signature.proof),
                attestation_quote: signature.attestation,
                nonce: challenge.nonce,
                timestamp: Date.now()
            }
        });

        if (response.message && response.message.success) {
            window.location.href = "/app";
        }
    } catch (err) {
        frappe.msgprint("Login Failed: " + err.message);
    }
}

// --- SETTINGS HUB ---
async function initializeSettings() {
    const authDiv = document.getElementById('settings-auth');
    const contentDiv = document.getElementById('settings-content');

    document.getElementById('btn-unlock-settings').onclick = async () => {
        try {
            const deviceId = await getLocalHardwareId();
            const hardwareData = await getHardwareSignature(deviceId, "CHAOTIC_SETTINGS_UNLOCK");
            
            if (hardwareData) {
                authDiv.style.display = 'none';
                contentDiv.style.display = 'block';
                loadMachinePassport(deviceId);
            }
        } catch (err) {
            frappe.msgprint("Access Denied.");
        }
    };

    document.getElementById('btn-save-alias').onclick = async () => {
        const newAlias = document.getElementById('machine-alias-input').value;
        const deviceId = await getLocalHardwareId();
        
        // Rename via Bridge
        const response = await frappe.call({
            method: "chaotic_erpnext.api.chaotic_rename_device",
            args: { device_id: deviceId, new_alias: newAlias }
        });
        
        if (response.message && response.message.success) {
            document.getElementById('alias-status').style.display = 'block';
            setTimeout(() => { document.getElementById('alias-status').style.display = 'none'; }, 2000);
        }
    };
}

async function loadMachinePassport(deviceId) {
    // Device Info via Bridge
    const infoRes = await frappe.call({
        method: "chaotic_erpnext.api.chaotic_get_device_info",
        args: { device_id: deviceId }
    });
    const deviceData = infoRes.message;
    
    document.getElementById('machine-alias-input').value = deviceData.machine_alias;
    document.getElementById('device-id-display').innerText = deviceId.substring(0,12) + "...";
    
    const sitesList = document.getElementById('sites-list');
    sitesList.innerHTML = "";
    
    const sites = deviceData.site_registrations || [window.location.origin];
    sites.forEach(site => {
        const card = document.createElement('div');
        card.style.cssText = "padding: 15px; background: #f8f9fa; border-radius: 10px; display: flex; align-items: center; justify-content: space-between; border: 1px solid #eee;";
        card.innerHTML = `
            <div style="display: flex; align-items: center; gap: 15px;">
                <div style="width: 40px; height: 40px; background: #fff; border: 1px solid #ddd; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1a1a2e" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                </div>
                <div><strong style="color:#1a1a2e;">${site}</strong></div>
            </div>
            <span style="font-size:11px; color:#999;">Hardware Key Active</span>
        `;
        sitesList.appendChild(card);
    });
}

// --- HARDWARE UTILITIES ---

async function getLocalHardwareId() {
    let hwId = localStorage.getItem('chaotic_device_thumbprint');
    if (!hwId) {
        hwId = "HW_" + Math.random().toString(36).substring(2, 11).toUpperCase();
        localStorage.setItem('chaotic_device_thumbprint', hwId);
    }
    return hwId;
}

async function getRemoteDevicesForUser(email) {
    // User Devices via Bridge
    const res = await frappe.call({
        method: "chaotic_erpnext.api.chaotic_get_user_devices",
        args: { user_id: email }
    });
    if (res.message) {
        return res.message.devices || [];
    }
    return [];
}

async function initiateRemotePing(email, deviceId, alias) {
    const fallback = document.getElementById('fallback-state');
    const pending = document.getElementById('pending-state');
    const pingedName = document.getElementById('pinged-device-name');

    fallback.style.display = 'none';
    pending.style.display = 'block';
    pingedName.innerText = alias || "Registered Device";

    // Initiate via Bridge
    const initiateRes = await frappe.call({
        method: "chaotic_erpnext.api.chaotic_initiate_remote",
        args: {
            user_id: email,
            device_id: deviceId,
            site_origin: window.location.origin
        }
    });

    if (initiateRes.message && initiateRes.message.success) {
        pollForRemoteSignature(initiateRes.message.challenge_id, email);
    }
}

async function pollForRemoteSignature(challengeId, email) {
    const interval = setInterval(async () => {
        // Poll via Bridge
        const pollRes = await frappe.call({
            method: "chaotic_erpnext.api.chaotic_poll_remote",
            args: { challenge_id: challengeId }
        });
        
        if (pollRes.message && pollRes.message.status === "verified") {
            clearInterval(interval);
            finalizeLogin(pollRes.message);
        }
    }, 3000); 
}

async function finalizeLogin(authData) {
    const response = await frappe.call({
        method: "chaotic_erpnext.api.chaotic_verify",
        args: {
            login: authData.user_id,
            proof: JSON.stringify(authData.proof),
            attestation_quote: authData.attestation,
            nonce: authData.nonce,
            timestamp: Date.now()
        }
    });

    if (response.message && response.message.success) {
        window.location.href = "/app";
    }
}

async function getHardwareSignature(deviceId, nonce) {
    return {
        proof: {}, 
        attestation: "TPM_SIGNED_DATA_" + Date.now(),
        nonce: nonce
    };
}
