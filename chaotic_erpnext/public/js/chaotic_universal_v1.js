/**
 * Chaotic Universal Identity Client (v1)
 * Handles hardware discovery, remote relay (Ping), and unified auth/signup flows.
 */

// --- CONFIGURATION ---
const CHAOTIC_API_URL = "http://localhost:8000"; // Should be retrieved from site_config in production

// --- STATE MANAGEMENT ---
let currentDeviceId = null;
let currentChallengeId = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("[Chaotic] Universal Hub Initialized");
    
    const path = window.location.pathname;
    
    if (path === '/chaotic-auth') {
        initializeDiscovery();
    } else if (path === '/chaotic-signup') {
        initializeSignup();
    } else if (path === '/chaotic-settings') {
        initializeSettings();
    }
});

// --- DISCOVERY HUB (chaotic-auth.html) ---
async function initializeDiscovery() {
    const probing = document.getElementById('probing-state');
    const success = document.getElementById('success-state');
    const fallback = document.getElementById('fallback-state');

    try {
        // 1. Probe for local TPM identity
        const deviceId = await getLocalHardwareId();
        const deviceInfo = await checkDeviceEnrolled(deviceId);

        if (deviceInfo.exists) {
            // Local device found!
            currentDeviceId = deviceId;
            probing.style.display = 'none';
            success.style.display = 'block';
            document.getElementById('device-alias').innerText = deviceInfo.alias || "Recognized Machine";
            document.getElementById('linked-email').innerText = deviceInfo.user_id;

            document.getElementById('btn-login-local').onclick = () => loginWithHardware(deviceId, deviceInfo.user_id);
        } else {
            // Not a recognized machine
            currentDeviceId = deviceId; // still keep the ID for potential signup
            probing.style.display = 'none';
            fallback.style.display = 'block';
        }
    } catch (err) {
        console.warn("[Chaotic] Local probe failed:", err);
        probing.style.display = 'none';
        fallback.style.display = 'block';
    }

    // 2. Handle Remote Ping Initiation
    document.getElementById('btn-ping-devices').onclick = async () => {
        const email = document.getElementById('remote-email').value;
        if (!email) return frappe.msgprint("Please enter your email");

        const devices = await getRemoteDevicesForUser(email);
        const container = document.getElementById('remote-devices-container');
        const listDiv = document.getElementById('remote-device-list');
        
        container.innerHTML = "";
        if (devices.length === 0) {
            container.innerHTML = "<p style='color:red;'>No registered devices found for this email.</p>";
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

// --- SIGNUP FLOW (chaotic-signup.html) ---
async function initializeSignup() {
    const btn = document.getElementById('btn-signup-hardware');
    
    btn.onclick = async () => {
        const name = document.getElementById('signup-name').value;
        const email = document.getElementById('signup-email').value;
        
        if (!name || !email) return frappe.msgprint("All fields required");

        btn.disabled = true;
        document.getElementById('btn-text').style.display = 'none';
        document.getElementById('btn-loading').style.display = 'inline-block';

        try {
            const deviceId = await getLocalHardwareId();
            
            // Handshake Call to Frappe Backend
            const response = await frappe.call({
                method: "chaotic_erpnext.api.chaotic_signup",
                args: {
                    full_name: name,
                    email: email,
                    device_id: deviceId
                }
            });

            if (response.message && response.message.success) {
                // Success!
                document.getElementById('signup-form').style.display = 'none';
                document.getElementById('success-message').style.display = 'block';
                document.getElementById('success-email').innerText = email;
                
                setTimeout(() => {
                    window.location.href = "/login?signup=success";
                }, 2000);
            }
        } catch (err) {
            frappe.msgprint("Signup Failed: " + (err.message || err.exception));
            btn.disabled = false;
            document.getElementById('btn-text').style.display = 'inline-block';
            document.getElementById('btn-loading').style.display = 'none';
        }
    };
}

// --- SETTINGS HUB (chaotic-settings.html) ---
async function initializeSettings() {
    const authDiv = document.getElementById('settings-auth');
    const contentDiv = document.getElementById('settings-content');

    document.getElementById('btn-unlock-settings').onclick = async () => {
        try {
            const deviceId = await getLocalHardwareId();
            // Simple hardware challenge to verify owner
            const hardwareData = await getHardwareSignature(deviceId, "CHAOTIC_SETTINGS_UNLOCK");
            
            if (hardwareData) {
                authDiv.style.display = 'none';
                contentDiv.style.display = 'block';
                loadMachinePassport(deviceId);
            }
        } catch (err) {
            frappe.msgprint("Access Denied: Please use your registered machine.");
        }
    };

    document.getElementById('btn-save-alias').onclick = async () => {
        const newAlias = document.getElementById('machine-alias-input').value;
        const deviceId = await getLocalHardwareId();
        
        const response = await fetch(`${CHAOTIC_API_URL}/api/devices/rename`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_id: deviceId, new_alias: newAlias })
        });
        
        if (response.ok) {
            document.getElementById('alias-status').style.display = 'block';
            setTimeout(() => { document.getElementById('alias-status').style.display = 'none'; }, 2000);
        }
    };
}

async function loadMachinePassport(deviceId) {
    const deviceData = await fetch(`${CHAOTIC_API_URL}/api/devices/${deviceId}`).then(r => r.json());
    
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
    // In production, this pulls the actual TPM Unique Thumbprint/Serial.
    // For local dev, we use a persistent browser storage ID if TPM isn't initialized.
    let hwId = localStorage.getItem('chaotic_device_thumbprint');
    if (!hwId) {
        hwId = "HW_" + Math.random().toString(36).substring(2, 11).toUpperCase();
        localStorage.setItem('chaotic_device_thumbprint', hwId);
    }
    return hwId;
}

async function checkDeviceEnrolled(deviceId) {
    const res = await fetch(`${CHAOTIC_API_URL}/api/devices/${deviceId}`);
    if (res.status === 200) {
        const data = await res.json();
        return { exists: true, ...data };
    }
    return { exists: false };
}

async function getRemoteDevicesForUser(email) {
    const res = await fetch(`${CHAOTIC_API_URL}/api/devices/user/${email}`);
    if (res.ok) {
        const data = await res.json();
        return data.devices || [];
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

    // Call relay initiation
    const initiateRes = await fetch(`${CHAOTIC_API_URL}/api/auth/initiate_remote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            user_id: email,
            device_id: deviceId,
            site_origin: window.location.origin
        })
    }).then(r => r.json());

    if (initiateRes.success) {
        pollForRemoteSignature(initiateRes.challenge_id, email);
    }
}

async function pollForRemoteSignature(challengeId, email) {
    const interval = setInterval(async () => {
        const pollRes = await fetch(`${CHAOTIC_API_URL}/api/auth/poll_remote/${challengeId}`).then(r => r.json());
        
        if (pollRes.status === "verified") {
            clearInterval(interval);
            // We have the proof signed by the remote machine! Log in now.
            finalizeLogin(pollRes);
        }
    }, 3000); // Poll every 3 seconds
}

async function loginWithHardware(deviceId, email) {
    try {
        frappe.show_alert({message:__("Engaging Hardware Proof..."), indicator:'blue'});
        
        // Call local authority challenge
        const challenge = await fetch(`${CHAOTIC_API_URL}/api/auth/challenge`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: email, device_id: deviceId })
        }).then(r => r.json());

        // Get signature from TPM
        const signature = await getHardwareSignature(deviceId, challenge.nonce);

        // Verify with Frappe
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

async function finalizeLogin(authData) {
    // This is the callback for the Remote Ping flow
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
    // Stand-in for actual TPM quote production
    return {
        proof: {}, 
        attestation: "TPM_SIGNED_DATA_" + Date.now(),
        nonce: nonce
    };
}
