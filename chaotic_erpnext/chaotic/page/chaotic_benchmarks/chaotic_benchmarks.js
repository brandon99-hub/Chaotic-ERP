frappe.pages['chaotic-benchmarks'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Auth Benchmarks',
		single_column: true
	});

	// Load template
	$(frappe.render_template("chaotic_benchmarks", {})).appendTo(page.main);

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
