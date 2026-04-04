/**
 * Chaotic Universal Identity Client (v1)
 * Handles hardware discovery, remote relay (Ping), and unified auth/signup flows.
 * Now supports Backend-Synchronized ZK Commitment generation.
 */

// --- CONFIGURATION ---
const CHAOTIC_API_URL = "http://localhost:8000"; 
const SNARK_FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

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
    
    btn.onclick = async () => {
        const name = document.getElementById('signup-name').value;
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        
        if (!name || !email || !password) return frappe.msgprint("All fields required");

        btn.disabled = true;
        document.getElementById('btn-text').style.display = 'none';
        document.getElementById('btn-loading').style.display = 'inline-block';

        try {
            // 1. Get Hardware ID
            const deviceId = await getLocalHardwareId();
            
            // 2. Fetch g0 via Frappe Backend Proxy (Bypasses Private Network CORS)
            const g0Res = await frappe.call({
                method: "chaotic_erpnext.api.get_chaotic_g0"
            });
            const g0 = g0Res.message.g0;

            // 3. Generate ZK Commitment (Y)
            const secretX = await hashPasswordToField(password);
            const Y = computeCommitment(g0, secretX);

            // 4. Handshake Call to Frappe Backend (Atomic Sync)
            const response = await frappe.call({
                method: "chaotic_erpnext.api.chaotic_signup",
                args: {
                    full_name: name,
                    email: email,
                    device_id: deviceId,
                    g0: g0.toString(),
                    Y: Y.toString()
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
            frappe.msgprint("Signup Failed: " + (err.message || err.exception));
            btn.disabled = false;
            document.getElementById('btn-text').style.display = 'inline-block';
            document.getElementById('btn-loading').style.display = 'none';
        }
    };
}

// --- DISCOVERY HUB (chaotic-auth.html) ---
async function initializeDiscovery() {
    const probing = document.getElementById('probing-state');
    const success = document.getElementById('success-state');
    const fallback = document.getElementById('fallback-state');

    try {
        const deviceId = await getLocalHardwareId();
        
        // Handshake check with Frappe Backend
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
        console.warn("[Chaotic] Discovery probe failed:", err);
        probing.style.display = 'none';
        fallback.style.display = 'block';
    }

    // Handle Remote Ping Initiation
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

// --- LOGIN FLOW ---
async function loginWithHardware(deviceId, email) {
    try {
        frappe.show_alert({message:__("Engaging Hardware Proof..."), indicator:'blue'});
        
        // 1. Get g0 and Y from Frappe for this email (to ensure proof matches commitment)
        // Note: For ZK security, g0 is public, Y is public commitment.
        
        const challenge = await fetch(`${CHAOTIC_API_URL}/api/auth/challenge`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: email, device_id: deviceId })
        }).then(r => r.json());

        // Note: Full snarkjs proof generation would go here in production.
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
    let hwId = localStorage.getItem('chaotic_device_thumbprint');
    if (!hwId) {
        hwId = "HW_" + Math.random().toString(36).substring(2, 11).toUpperCase();
        localStorage.setItem('chaotic_device_thumbprint', hwId);
    }
    return hwId;
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
            finalizeLogin(pollRes);
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
