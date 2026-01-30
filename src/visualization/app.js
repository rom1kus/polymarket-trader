/**
 * Polymarket Trading Visualizer - Main Application
 */

let manifest = null;
let currentSession = null;
let charts = {};

// Initialize app
async function init() {
  try {
    // Load manifest
    const response = await fetch('manifest.json');
    manifest = await response.json();
    
    // Show app
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display = 'grid';
    
    // Render sidebar
    renderSidebar();
    
    // Auto-select first session if available
    if (manifest.files.length > 0) {
      loadSession(manifest.files[0].filename);
    }
  } catch (error) {
    document.getElementById('loading').innerHTML = `
      <div class="error">
        <strong>Error loading manifest:</strong> ${error.message}<br>
        Make sure you're running this via <code>npm run visualize</code>
      </div>
    `;
  }
}

// Render sidebar with session list
function renderSidebar() {
  const sessionList = document.getElementById('sessionList');
  const sessionCount = document.getElementById('sessionCount');
  
  sessionCount.textContent = `${manifest.count} session${manifest.count !== 1 ? 's' : ''} found`;
  
  if (manifest.count === 0) {
    sessionList.innerHTML = '<p style="color: var(--text-secondary);">No trading sessions found in data/</p>';
    return;
  }
  
  sessionList.innerHTML = manifest.files.map(file => `
    <div class="session-item" data-filename="${file.filename}">
      <div class="session-id">${file.conditionId ? file.conditionId.slice(0, 18) + '...' : 'Unknown Market'}</div>
      <div class="session-meta">
        <span class="trade-count">${file.tradeCount} trades</span>
        <span>${formatDate(file.lastUpdated)}</span>
      </div>
    </div>
  `).join('');
  
  // Add click handlers
  document.querySelectorAll('.session-item').forEach(item => {
    item.addEventListener('click', () => {
      loadSession(item.dataset.filename);
    });
  });
}

// Load and display a trading session
async function loadSession(filename) {
  try {
    const response = await fetch(`../../data/${filename}`);
    currentSession = await response.json();
    
    // Update active state in sidebar
    document.querySelectorAll('.session-item').forEach(item => {
      item.classList.toggle('active', item.dataset.filename === filename);
    });
    
    // Render content
    renderMainContent();
  } catch (error) {
    showError(`Error loading session: ${error.message}`);
  }
}

// Render main content area
function renderMainContent() {
  const main = document.getElementById('mainContent');
  const data = currentSession;
  
  // Calculate metrics
  const metrics = calculateMetrics(data);
  
  main.innerHTML = `
    <div class="header">
      <h2>Trading Session Analytics</h2>
      <div class="header-meta">
        Market: ${data.conditionId.slice(0, 24)}...
        <span style="margin-left: 1rem;">
          ${formatDate(data.fills[0]?.timestamp)} — ${formatDate(data.fills[data.fills.length - 1]?.timestamp)}
        </span>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Trades</div>
        <div class="stat-value">${data.fills.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Volume</div>
        <div class="stat-value">$${metrics.totalVolume.toFixed(2)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Cost</div>
        <div class="stat-value">$${metrics.totalCost.toFixed(2)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Unrealized P&L</div>
        <div class="stat-value ${metrics.unrealizedPnL >= 0 ? 'positive' : 'negative'}">
          ${metrics.unrealizedPnL >= 0 ? '+' : ''}$${metrics.unrealizedPnL.toFixed(2)}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">YES Position</div>
        <div class="stat-value positive">${metrics.yesPosition.toFixed(2)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">NO Position</div>
        <div class="stat-value negative">${metrics.noPosition.toFixed(2)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Net Exposure</div>
        <div class="stat-value ${metrics.netExposure >= 0 ? 'positive' : 'negative'}">
          ${metrics.netExposure >= 0 ? '+' : ''}${metrics.netExposure.toFixed(2)}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg YES Price</div>
        <div class="stat-value">${metrics.avgYesPrice.toFixed(3)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg NO Price</div>
        <div class="stat-value">${metrics.avgNoPrice.toFixed(3)}</div>
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-container">
        <h3 class="chart-title">Price Evolution Over Time</h3>
        <div class="chart-wrapper">
          <canvas id="priceChart" class="chart-canvas"></canvas>
        </div>
      </div>

      <div class="chart-container">
        <h3 class="chart-title">Cumulative Position Building</h3>
        <div class="chart-wrapper">
          <canvas id="positionChart" class="chart-canvas"></canvas>
        </div>
      </div>

      <div class="chart-container">
        <h3 class="chart-title">Trade Volume by Price</h3>
        <div class="chart-wrapper">
          <canvas id="distributionChart" class="chart-canvas"></canvas>
        </div>
      </div>

      <div class="chart-container">
        <h3 class="chart-title">Cumulative Cost Over Time</h3>
        <div class="chart-wrapper">
          <canvas id="costChart" class="chart-canvas"></canvas>
        </div>
      </div>

      <div class="chart-container">
        <h3 class="chart-title">Unrealized P&L (Mark-to-Market)</h3>
        <div class="chart-wrapper">
          <canvas id="pnlChart" class="chart-canvas"></canvas>
        </div>
      </div>
    </div>
  `;
  
  // Destroy old charts
  Object.values(charts).forEach(chart => chart.destroy());
  charts = {};
  
  // Render charts
  setTimeout(() => {
    renderPriceChart(data);
    renderPositionChart(data);
    renderDistributionChart(data);
    renderCostChart(data, metrics);
    renderPnLChart(data, metrics);
  }, 100);
}

// Calculate key metrics
function calculateMetrics(data) {
  const yesFills = data.fills.filter(f => f.outcome === 'Yes');
  const noFills = data.fills.filter(f => f.outcome === 'No');
  
  // Calculate from fills (actual trades)
  const totalVolume = data.fills.reduce((sum, f) => sum + (f.price * f.size), 0);
  
  // Calculate position sizes from fills
  const yesBuys = yesFills.filter(f => f.side === 'BUY');
  const yesSells = yesFills.filter(f => f.side === 'SELL');
  const noBuys = noFills.filter(f => f.side === 'BUY');
  const noSells = noFills.filter(f => f.side === 'SELL');
  
  const yesPosition = yesBuys.reduce((sum, f) => sum + f.size, 0) - yesSells.reduce((sum, f) => sum + f.size, 0);
  const noPosition = noBuys.reduce((sum, f) => sum + f.size, 0) - noSells.reduce((sum, f) => sum + f.size, 0);
  
  const avgYesPrice = yesFills.length > 0 
    ? yesFills.reduce((sum, f) => sum + f.price * f.size, 0) / yesFills.reduce((sum, f) => sum + f.size, 0)
    : 0;
  
  const avgNoPrice = noFills.length > 0
    ? noFills.reduce((sum, f) => sum + f.price * f.size, 0) / noFills.reduce((sum, f) => sum + f.size, 0)
    : 0;
  
  // Calculate unrealized P&L using last trade prices as mark-to-market
  const lastYesFill = yesFills.length > 0 ? yesFills[yesFills.length - 1] : null;
  const lastNoFill = noFills.length > 0 ? noFills[noFills.length - 1] : null;
  
  const currentYesPrice = lastYesFill ? lastYesFill.price : avgYesPrice;
  const currentNoPrice = lastNoFill ? lastNoFill.price : avgNoPrice;
  
  const yesValue = yesPosition * currentYesPrice;
  const noValue = noPosition * currentNoPrice;
  const totalValue = yesValue + noValue;
  const unrealizedPnL = totalValue - totalVolume;
  
  return {
    totalVolume,
    totalCost: totalVolume, // Total cost = total volume (money spent on trades)
    yesPosition,
    noPosition,
    netExposure: yesPosition - noPosition,
    avgYesPrice,
    avgNoPrice,
    unrealizedPnL
  };
}

// Chart: Price Evolution
function renderPriceChart(data) {
  const ctx = document.getElementById('priceChart').getContext('2d');
  
  const yesFills = data.fills.filter(f => f.outcome === 'Yes');
  const noFills = data.fills.filter(f => f.outcome === 'No');
  
  charts.price = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'YES Trades',
          data: yesFills.map(f => ({ x: f.timestamp, y: f.price })),
          borderColor: '#34a853',
          backgroundColor: 'rgba(52, 168, 83, 0.1)',
          tension: 0.1
        },
        {
          label: 'NO Trades',
          data: noFills.map(f => ({ x: f.timestamp, y: f.price })),
          borderColor: '#ea4335',
          backgroundColor: 'rgba(234, 67, 53, 0.1)',
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
          ticks: {
            callback: (value) => formatTime(value),
            color: '#9aa0a6'
          },
          grid: { color: '#3c4043' }
        },
        y: {
          beginAtZero: true,
          max: 1,
          ticks: {
            callback: (value) => `$${value.toFixed(2)}`,
            color: '#9aa0a6'
          },
          grid: { color: '#3c4043' }
        }
      },
      plugins: {
        legend: {
          labels: { color: '#e8eaed' }
        },
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label}: $${context.parsed.y.toFixed(3)}`
          }
        }
      }
    }
  });
}

// Chart: Position Building
function renderPositionChart(data) {
  const ctx = document.getElementById('positionChart').getContext('2d');
  
  let yesPos = data.initialPosition?.yesTokens || 0;
  let noPos = data.initialPosition?.noTokens || 0;
  
  const positions = data.fills.map(f => {
    if (f.outcome === 'Yes') {
      if (f.side === 'BUY') yesPos += f.size;
      else yesPos -= f.size;
    } else {
      if (f.side === 'BUY') noPos += f.size;
      else noPos -= f.size;
    }
    
    return {
      timestamp: f.timestamp,
      yes: yesPos,
      no: noPos,
      net: yesPos - noPos
    };
  });
  
  charts.position = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'YES Tokens',
          data: positions.map(p => ({ x: p.timestamp, y: p.yes })),
          borderColor: '#34a853',
          backgroundColor: 'rgba(52, 168, 83, 0.2)',
          fill: true
        },
        {
          label: 'NO Tokens',
          data: positions.map(p => ({ x: p.timestamp, y: p.no })),
          borderColor: '#ea4335',
          backgroundColor: 'rgba(234, 67, 53, 0.2)',
          fill: true
        },
        {
          label: 'Net Exposure',
          data: positions.map(p => ({ x: p.timestamp, y: p.net })),
          borderColor: '#fbbc04',
          backgroundColor: 'rgba(251, 188, 4, 0.1)',
          borderWidth: 2,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
          ticks: {
            callback: (value) => formatTime(value),
            color: '#9aa0a6'
          },
          grid: { color: '#3c4043' }
        },
        y: {
          ticks: {
            callback: (value) => value.toFixed(1),
            color: '#9aa0a6'
          },
          grid: { color: '#3c4043' }
        }
      },
      plugins: {
        legend: {
          labels: { color: '#e8eaed' }
        }
      }
    }
  });
}

// Chart: Distribution
function renderDistributionChart(data) {
  const ctx = document.getElementById('distributionChart').getContext('2d');
  
  // Create price buckets
  const bucketSize = 0.05;
  const buckets = {};
  
  data.fills.forEach(f => {
    const bucket = Math.floor(f.price / bucketSize) * bucketSize;
    const key = bucket.toFixed(2);
    
    if (!buckets[key]) {
      buckets[key] = { yes: 0, no: 0 };
    }
    
    if (f.outcome === 'Yes') {
      buckets[key].yes += f.size;
    } else {
      buckets[key].no += f.size;
    }
  });
  
  const labels = Object.keys(buckets).sort((a, b) => parseFloat(a) - parseFloat(b));
  
  charts.distribution = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map(l => `$${l}`),
      datasets: [
        {
          label: 'YES Volume',
          data: labels.map(l => buckets[l].yes),
          backgroundColor: 'rgba(52, 168, 83, 0.7)'
        },
        {
          label: 'NO Volume',
          data: labels.map(l => buckets[l].no),
          backgroundColor: 'rgba(234, 67, 53, 0.7)'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: '#9aa0a6' },
          grid: { color: '#3c4043' }
        },
        y: {
          ticks: {
            callback: (value) => value.toFixed(0),
            color: '#9aa0a6'
          },
          grid: { color: '#3c4043' }
        }
      },
      plugins: {
        legend: {
          labels: { color: '#e8eaed' }
        }
      }
    }
  });
}

// Chart: Cost Over Time
function renderCostChart(data, metrics) {
  const ctx = document.getElementById('costChart').getContext('2d');
  
  let cumCost = 0;
  const costOverTime = data.fills.map(f => {
    cumCost += f.price * f.size;
    return { x: f.timestamp, y: cumCost };
  });
  
  charts.cost = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Cumulative Cost',
          data: costOverTime,
          borderColor: '#8ab4f8',
          backgroundColor: 'rgba(138, 180, 248, 0.1)',
          fill: true,
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
          ticks: {
            callback: (value) => formatTime(value),
            color: '#9aa0a6'
          },
          grid: { color: '#3c4043' }
        },
        y: {
          ticks: {
            callback: (value) => `$${value.toFixed(2)}`,
            color: '#9aa0a6'
          },
          grid: { color: '#3c4043' }
        }
      },
      plugins: {
        legend: {
          labels: { color: '#e8eaed' }
        },
        tooltip: {
          callbacks: {
            label: (context) => `Cost: $${context.parsed.y.toFixed(2)}`
          }
        }
      }
    }
  });
}

// Chart: Unrealized P&L
function renderPnLChart(data, metrics) {
  const ctx = document.getElementById('pnlChart').getContext('2d');
  
  // Calculate P&L over time by tracking positions and costs
  let yesPos = data.initialPosition?.yesTokens || 0;
  let noPos = data.initialPosition?.noTokens || 0;
  let yesCost = 0;
  let noCost = 0;
  
  const pnlOverTime = data.fills.map(f => {
    // Update position and cost
    if (f.outcome === 'Yes') {
      if (f.side === 'BUY') {
        yesPos += f.size;
        yesCost += f.price * f.size;
      } else {
        yesPos -= f.size;
        // When selling, reduce cost proportionally
        const avgCost = yesPos > 0 ? yesCost / yesPos : 0;
        yesCost -= avgCost * f.size;
      }
    } else {
      if (f.side === 'BUY') {
        noPos += f.size;
        noCost += f.price * f.size;
      } else {
        noPos -= f.size;
        const avgCost = noPos > 0 ? noCost / noPos : 0;
        noCost -= avgCost * f.size;
      }
    }
    
    // Get current midpoint (use last trade price as proxy)
    // For proper P&L, we'd need actual market prices, but we'll estimate
    // Assume YES price = last YES fill, NO price = last NO fill
    const lastYesTrade = data.fills.slice(0, data.fills.indexOf(f) + 1)
      .reverse().find(fill => fill.outcome === 'Yes');
    const lastNoTrade = data.fills.slice(0, data.fills.indexOf(f) + 1)
      .reverse().find(fill => fill.outcome === 'No');
    
    const yesPrice = lastYesTrade ? lastYesTrade.price : 0.5;
    const noPrice = lastNoTrade ? lastNoTrade.price : 0.5;
    
    // Calculate unrealized P&L
    const yesValue = yesPos * yesPrice;
    const noValue = noPos * noPrice;
    const totalValue = yesValue + noValue;
    const totalCost = yesCost + noCost;
    const unrealizedPnL = totalValue - totalCost;
    
    return {
      x: f.timestamp,
      y: unrealizedPnL
    };
  });
  
  charts.pnl = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Unrealized P&L',
          data: pnlOverTime,
          borderColor: pnlOverTime[pnlOverTime.length - 1]?.y >= 0 ? '#34a853' : '#ea4335',
          backgroundColor: pnlOverTime[pnlOverTime.length - 1]?.y >= 0 
            ? 'rgba(52, 168, 83, 0.1)' 
            : 'rgba(234, 67, 53, 0.1)',
          fill: true,
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
          ticks: {
            callback: (value) => formatTime(value),
            color: '#9aa0a6'
          },
          grid: { color: '#3c4043' }
        },
        y: {
          ticks: {
            callback: (value) => `$${value.toFixed(2)}`,
            color: '#9aa0a6'
          },
          grid: { 
            color: '#3c4043',
            drawBorder: true
          }
        }
      },
      plugins: {
        legend: {
          labels: { color: '#e8eaed' }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const val = context.parsed.y;
              return `P&L: ${val >= 0 ? '+' : ''}$${val.toFixed(2)}`;
            }
          }
        }
      }
    }
  });
}

// Utility functions
function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  const date = new Date(timestamp / 1000); // Convert microseconds to ms
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatTime(timestamp) {
  const date = new Date(timestamp / 1000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function showError(message) {
  document.getElementById('mainContent').innerHTML = `
    <div class="error">${message}</div>
  `;
}

// Start app
init();
