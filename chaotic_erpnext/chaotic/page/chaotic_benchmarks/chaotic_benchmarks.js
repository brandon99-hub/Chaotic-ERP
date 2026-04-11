frappe.pages['chaotic-benchmarks'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Auth Benchmarks',
		single_column: true
	});

	// Load template
	const templateHtml = `
<div class="chaotic-benchmarks-container" style="padding: 20px; font-family: 'Inter', system-ui, sans-serif; background: #fafbfc; min-height: 100vh;">
    <!-- Dashboard Header -->
    <div class="row" style="margin-bottom: 30px;">
        <div class="col-md-12">
            <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; border-radius: 20px; color: white; box-shadow: 0 10px 30px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: space-between;">
                <div>
                    <h2 style="margin: 0; font-weight: 800; letter-spacing: -0.5px; font-size: 28px;">Chaotic Auth Benchmarks</h2>
                    <p style="margin: 5px 0 0; opacity: 0.7; font-size: 14px;">Real-time performance metrics and security audit</p>
                </div>
                <div id="connection-status" style="background: rgba(255,255,255,0.1); padding: 8px 16px; border-radius: 30px; border: 1px solid rgba(255,255,255,0.2); font-size: 12px; display: flex; align-items: center; gap: 8px;">
                    <span id="status-dot" style="width: 10px; height: 10px; border-radius: 50%; background: #ff4757; box-shadow: 0 0 10px #ff4757;"></span>
                    <span id="status-text">Disconnected</span>
                </div>
            </div>
        </div>
    </div>

    <!-- Metrics Grid -->
    <div class="row" style="margin-bottom: 30px;">
        <!-- Card 1: Challenge Latency -->
        <div class="col-md-4">
            <div class="metric-card" style="background: white; padding: 25px; border-radius: 20px; border: 1px solid #eee; text-align: center; transition: all 0.3s ease;">
                <div style="color: #999; font-size: 12px; font-weight: 600; text-transform: uppercase;">Challenge Gen</div>
                <div id="stat-challenge" style="font-size: 42px; font-weight: 800; color: #1a1a2e; margin: 10px 0;">--</div>
                <div style="color: #2ed573; font-size: 11px; font-weight: 600;">Sub-10ms Target &check;</div>
            </div>
        </div>
        <!-- Card 2: Verification Latency -->
        <div class="col-md-4">
            <div class="metric-card" style="background: white; padding: 25px; border-radius: 20px; border: 1px solid #eee; text-align: center;">
                <div style="color: #999; font-size: 12px; font-weight: 600; text-transform: uppercase;">ZKP Verification</div>
                <div id="stat-verify" style="font-size: 42px; font-weight: 800; color: #1a1a2e; margin: 10px 0;">--</div>
                <div style="color: #2ed573; font-size: 11px; font-weight: 600;">Industry-leading speed &check;</div>
            </div>
        </div>
        <!-- Card 3: Security Score -->
        <div class="col-md-4">
            <div class="metric-card" style="background: white; padding: 25px; border-radius: 20px; border: 1px solid #eee; text-align: center;">
                <div style="color: #999; font-size: 12px; font-weight: 600; text-transform: uppercase;">Security Integrity</div>
                <div id="stat-score" style="font-size: 42px; font-weight: 800; color: #1a1a2e; margin: 10px 0;">-- %</div>
                <div style="color: #3742fa; font-size: 11px; font-weight: 600;">Hardware Attested &check;</div>
            </div>
        </div>
    </div>

    <!-- Chart and Comparison Area -->
    <div class="row">
        <!-- Comparison Chart -->
        <div class="col-md-8">
            <div style="background: white; padding: 30px; border-radius: 20px; border: 1px solid #eee; height: 100%;">
                <h4 style="margin: 0 0 20px; font-weight: 700; color: #1a1a2e;">Competitive Latency Contrast</h4>
                <div id="latency-chart" style="height: 300px;"></div>
                <p style="margin-top: 20px; font-size: 12px; color: #666; font-style: italic;">Values represent average authentication overhead in milliseconds.</p>
            </div>
        </div>
        <!-- Attack Checklist -->
        <div class="col-md-4">
            <div style="background: #1a1a2e; padding: 30px; border-radius: 20px; color: white; height: 100%;">
                <h4 style="margin: 0 0 20px; font-weight: 700;">Security Audit</h4>
                <div id="security-checklist" style="display: flex; flex-direction: column; gap: 15px;">
                    <!-- Loading state -->
                    <div style="opacity: 0.5;">Awaiting diagnostic data...</div>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
.metric-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 15px 35px rgba(0,0,0,0.05);
}
.security-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    background: rgba(255,255,255,0.05);
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.1);
}
.check-icon {
    width: 20px;
    height: 20px;
    background: #2ed573;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
}
</style>
`;
	$(templateHtml).appendTo(page.main);

	// Initialize dashboard
	const dashboard = new ChaoticBenchmarkDashboard(wrapper);
	dashboard.refresh();

	// Poll every 10 seconds for live updates
	setInterval(() => {
		dashboard.refresh();
	}, 10000);
}

class ChaoticBenchmarkDashboard {
	constructor(wrapper) {
		this.wrapper = $(wrapper);
		this.chart = null;
	}

	async refresh() {
		try {
			const res = await frappe.call({
				method: "chaotic_erpnext.api.get_chaotic_benchmarks"
			});

			if (res.message && res.message.success) {
				this.updateStats(res.message.stats);
				this.updateChart(res.message.comparison);
				this.updateSecurity(res.message.stats.pass_fail_matrix);
				this.updateStatus(true);
			} else {
				this.updateStatus(false);
			}
		} catch (err) {
			console.error("[Chaotic] Dashboard Refresh Failed", err);
			this.updateStatus(false);
		}
	}

	updateStatus(isOnline) {
		const dot = this.wrapper.find('#status-dot');
		const text = this.wrapper.find('#status-text');
		if (isOnline) {
			dot.css({ "background": "#2ed573", "box-shadow": "0 0 10px #2ed573" });
			text.text("Authority Active (Port 8088)");
		} else {
			dot.css({ "background": "#ff4757", "box-shadow": "0 0 10px #ff4757" });
			text.text("Authority Offline");
		}
	}

	updateStats(stats) {
		this.wrapper.find('#stat-challenge').text(stats.avg_challenge_gen_ms.toFixed(1) + "ms");
		this.wrapper.find('#stat-verify').text(stats.avg_verification_ms.toFixed(1) + "ms");
		this.wrapper.find('#stat-score').text(stats.security_score.toFixed(0) + "%");
	}

	updateSecurity(matrix) {
		const container = this.wrapper.find('#security-checklist');
		container.empty();

		Object.entries(matrix).forEach(([key, value]) => {
			const label = key.replace(/_/g, ' ').toUpperCase();
			const item = $(`
				<div class="security-item">
					<span style="font-size: 13px; font-weight: 500;">${label}</span>
					<div class="status-badge" style="display: flex; align-items: center; gap: 8px;">
						<span style="font-size: 11px; font-weight: 700; color: #2ed573;">${value}</span>
						<div class="check-icon"><i class="fa fa-check"></i></div>
					</div>
				</div>
			`);
			container.append(item);
		});
	}

	updateChart(comparison) {
		const labels = comparison.map(c => c.method);
		const data = comparison.map(c => c.latency);

		if (!this.chart) {
			this.chart = new frappe.Chart("#latency-chart", {
				title: "Latency Comparison (ms)",
				data: {
					labels: labels,
					datasets: [{ values: data }]
				},
				type: 'bar',
				height: 250,
				colors: ['#1a1a2e', '#3742fa', '#2ed573'],
				barOptions: { spaceRatio: 0.5 }
			});
		} else {
			this.chart.update({
				labels: labels,
				datasets: [{ values: data }]
			});
		}
	}
}
