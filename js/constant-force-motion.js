const DT = 0.01;
const G = 9.81;
const CANVAS_ID = 'constant-force-canvas';

let animationFrameId = null;
let simulationRunning = false;
let lastTimestamp = 0;
let totalTime = 0;

let position_x = 0;
let velocity_x = 0;
let acceleration_x = 0;
let initial_acceleration = 0;
let graphData = [];
let phaseTransitions = [];

const canvas = document.getElementById(CANVAS_ID);
const ctx = canvas ? canvas.getContext('2d') : null;
const visualHint = document.querySelector('.visual-hint');

const inputs = {
    mass: document.getElementById('constant-force-mass'),
    force: document.getElementById('constant-force-force'),
    friction_k: document.getElementById('constant-force-friction'),
    friction_s: document.getElementById('constant-force-static-friction'),
    angle_presets: document.getElementById('constant-force-angle-presets'),
    angle_custom: document.getElementById('constant-force-angle-custom'),
    normal_extra: document.getElementById('constant-force-normal-force'),
    track_length: document.getElementById('constant-force-length'),
    show_vectors: document.getElementById('constant-force-show-vectors'),
    show_graphs: document.getElementById('constant-force-show-graph'),
    stopping_test: document.getElementById('constant-force-stopping-test')
};

const outputs = {
    mass: document.getElementById('constant-force-mass-value'),
    force: document.getElementById('constant-force-force-value'),
    friction_k: document.getElementById('constant-force-friction-value'),
    friction_s: document.getElementById('constant-force-static-friction-value'),
    normal_extra: document.getElementById('constant-force-normal-force-value'),
    track_length: document.getElementById('constant-force-length-value')
};

let P = {
    m: 5,
    F_ext: 80,
    mu_k: 0.2,
    mu_s: 0.25,
    angle_deg: 0,
    angle_rad: 0,
    F_normal_extra: 0,
    L: 20,
    scale: 20
};

let M = {
    F_net: 0,
    F_gravity_x: 0,
    F_gravity_y: 0,
    F_friction: 0,
    F_normal: 0,
    W_friction_cum: 0,
    W_ext: 0,
    E_kin: 0
};

function updateParametersFromInputs() {
    if (!inputs.mass) return;

    P.m = parseFloat(inputs.mass.value);
    P.F_ext = parseFloat(inputs.force.value);
    P.mu_k = parseFloat(inputs.friction_k.value);
    P.mu_s = parseFloat(inputs.friction_s.value);
    P.F_normal_extra = parseFloat(inputs.normal_extra.value);
    P.L = parseFloat(inputs.track_length.value);

    let angle_deg = parseFloat(inputs.angle_custom.value);
    if (angle_deg === 0) {
        angle_deg = parseFloat(inputs.angle_presets.value);
    }
    P.angle_deg = angle_deg;
    P.angle_rad = angle_deg * Math.PI / 180;

    if (outputs.mass) outputs.mass.textContent = P.m;
    if (outputs.force) outputs.force.textContent = P.F_ext;
    if (outputs.friction_k) outputs.friction_k.textContent = P.mu_k.toFixed(2);
    if (outputs.friction_s) outputs.friction_s.textContent = P.mu_s.toFixed(2);
    if (outputs.normal_extra) outputs.normal_extra.textContent = P.F_normal_extra;
    if (outputs.track_length) outputs.track_length.textContent = P.L;
}

function resetState() {
    stopSimulation();
    updateParametersFromInputs();

    position_x = 0;
    velocity_x = 0;
    acceleration_x = 0;
    initial_acceleration = 0;
    totalTime = 0;
    M.W_friction_cum = 0;
    M.W_ext = 0;
    M.E_kin = 0;
    graphData = [];
    phaseTransitions = [];


    if (canvas) {
        P.scale = Math.min(canvas.width * 0.8 / P.L, 50);
    }
    calculateForces(0);
    drawSimulation();
    updateMetricsDisplay();
}

function calculateForces(current_velocity) {
    const angle_rad = P.angle_rad;
    const prev_F_net = M.F_net;
    const prev_velocity = velocity_x;

    M.F_gravity_x = P.m * G * Math.sin(angle_rad);
    M.F_gravity_y = P.m * G * Math.cos(angle_rad);

    M.F_normal = M.F_gravity_y + P.F_normal_extra;

    let F_friction_max_s = P.mu_s * M.F_normal;
    let F_friction_k = P.mu_k * M.F_normal;

    let F_driving = P.F_ext - M.F_gravity_x;
    if (Math.abs(current_velocity) < 0.001) {
        if (Math.abs(F_driving) <= F_friction_max_s) {
            M.F_friction = F_driving;
            M.F_net = 0;
            acceleration_x = 0;
            if (simulationRunning) {
                stopSimulation();
                phaseTransitions.push({ time: totalTime, type: 'stop' });
            }
        } else {
            M.F_friction = Math.sign(F_driving) * F_friction_k;
            M.F_net = F_driving - M.F_friction;
            acceleration_x = M.F_net / P.m;
            if (Math.abs(prev_velocity) < 0.001 && Math.abs(prev_F_net) === 0) {
                phaseTransitions.push({ time: totalTime, type: 'start' });
                initial_acceleration = acceleration_x;
            }
        }
    } else {
        const direction = Math.sign(current_velocity);
        M.F_friction = direction * F_friction_k;
        M.F_net = F_driving - M.F_friction;
        acceleration_x = M.F_net / P.m;

        if (current_velocity * acceleration_x < 0) {
            if (Math.abs(current_velocity) < 0.1 && Math.abs(F_driving) <= F_friction_max_s) {
                velocity_x = 0;
                calculateForces(0);
                if (phaseTransitions.length === 0 || phaseTransitions[phaseTransitions.length - 1].type !== 'stop') {
                    phaseTransitions.push({ time: totalTime, type: 'stop' });
                }
                return;
            }
        }
    }
}

function analyticalSolution(t) {
    const a = initial_acceleration;
    return {
        position: (a * t * t) / 2,
        velocity: a * t
    };
}

function step(dt) {
    calculateForces(velocity_x);
    const delta_x = velocity_x * dt;
    velocity_x += acceleration_x * dt;
    position_x += delta_x;
    totalTime += dt;
    M.W_friction_cum += Math.abs(M.F_friction * delta_x);
    M.W_ext += P.F_ext * delta_x;
    M.E_kin = 0.5 * P.m * velocity_x * velocity_x;
    graphData.push({
        t: totalTime,
        x: position_x,
        v: velocity_x
    });

    if (position_x >= P.L) {
        position_x = P.L;
        velocity_x = 0;
        acceleration_x = 0;
        stopSimulation();
        phaseTransitions.push({ time: totalTime, type: 'stop' });
    }

    if (position_x < 0) {
        position_x = 0;
        velocity_x = 0;
        acceleration_x = 0;
        stopSimulation();
        phaseTransitions.push({ time: totalTime, type: 'stop' });
    }
}

function drawSimulation() {
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const block_size = 50;
    const track_height = H * 0.8;
    const block_start_x = block_size / 2 + 10;
    const block_y_on_track = -H + track_height - block_size / 2;


    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(0, H);
    drawTrack(ctx, W, track_height);
    ctx.translate(block_start_x, block_y_on_track);
    ctx.rotate(-P.angle_rad);

    const block_x_offset = position_x * P.scale;
    drawBlock(ctx, block_x_offset, -block_size / 2, block_size);

    if (inputs.show_vectors && inputs.show_vectors.checked) {
        drawForceVectors(ctx, block_x_offset, block_size);
    }

    ctx.restore();

    if (inputs.show_graphs && inputs.show_graphs.checked) {
        drawGraphs(ctx, W, H);
    }

    ctx.fillStyle = '#003366';
    ctx.font = '16px Arial';
    ctx.fillText(`x: ${position_x.toFixed(2)} м | v: ${velocity_x.toFixed(2)} м/с | a: ${acceleration_x.toFixed(2)} м/с² | Время: ${totalTime.toFixed(2)} с`, 10, 20);
}

function drawBlock(ctx, x, y, size) {
    ctx.fillStyle = '#0066cc';
    ctx.fillRect(x - size / 2, y, size, size);
    ctx.strokeStyle = '#003366';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - size / 2, y, size, size);
}

function drawTrack(ctx, W, H_track) {
    if (M.W_friction_cum > 0) {
        const maxWork = P.mu_k * (P.m * G * Math.cos(P.angle_rad) + P.F_normal_extra) * P.L * 1.5;
        const heatRatio = Math.min(M.W_friction_cum / maxWork, 1.0);
        const r = Math.round(224 + (255 - 224) * heatRatio);
        const g = Math.round(224 + (69 - 224) * heatRatio);
        const b = Math.round(224 + (0 - 224) * heatRatio);

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    } else {
        ctx.fillStyle = '#e0e0e0';
    }

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, -H_track * Math.cos(P.angle_rad));
    ctx.lineTo(0, -H_track * Math.sin(P.angle_rad));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = '12px Arial';
    ctx.fillStyle = '#003366';
    ctx.fillText(`L = ${P.L} м`, W - 50, -50);
}

function drawForceVectors(ctx, block_x, block_size) {
    const F_scale = 0.5;
    const center_x = block_x;
    const center_y = 0;

    drawVector(ctx, center_x + block_size/2, center_y, P.F_ext, 0, '#388E3C', 'F_тяги', F_scale, true);
    drawVector(ctx, center_x - block_size/2, center_y, M.F_friction, Math.PI, '#D32F2F', 'F_тр', F_scale, true);
    drawVector(ctx, center_x, center_y - block_size/2 - 10, M.F_net, 0, '#003366', 'F_net', F_scale, true);

    ctx.save();
    ctx.rotate(P.angle_rad);
    const mg = P.m * G;
    drawVector(ctx, center_x, center_y, mg, -Math.PI / 2, '#7B1FA2', 'mg', F_scale, false);
    ctx.restore();

    drawVector(ctx, center_x, center_y, M.F_normal, -Math.PI / 2, '#FBC02D', 'N', F_scale, false);
}

function drawVector(ctx, start_x, start_y, magnitude, angle, color, label, scale, horizontal) {
    if (Math.abs(magnitude) < 0.1 && magnitude !== 0) return;
    const len = Math.abs(magnitude) * scale;
    const actual_angle = horizontal ? (magnitude >= 0 ? 0 : Math.PI) : angle;
    const end_x = start_x + len * Math.cos(actual_angle);
    const end_y = start_y + len * Math.sin(actual_angle);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(start_x, start_y);
    ctx.lineTo(end_x, end_y);
    ctx.stroke();

    const tip_angle = actual_angle;
    ctx.beginPath();
    ctx.moveTo(end_x, end_y);
    ctx.lineTo(end_x - 10 * Math.cos(tip_angle - Math.PI / 6), end_y - 10 * Math.sin(tip_angle - Math.PI / 6));
    ctx.moveTo(end_x, end_y);
    ctx.lineTo(end_x - 10 * Math.cos(tip_angle + Math.PI / 6), end_y - 10 * Math.sin(tip_angle + Math.PI / 6));
    ctx.stroke();

    const text_angle = actual_angle;
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(label, end_x + 10 * Math.cos(text_angle - Math.PI / 2), end_y + 10 * Math.sin(text_angle - Math.PI / 2));
}

function drawGraphs(ctx, W, H) {
    const graphH = H * 0.4;
    const graphY = H - graphH;
    const graphW = W;
    const padding = 50;
    const chartAreaW = graphW - padding * 1.5;
    const maxTime = Math.max(totalTime, 5);
    const maxV_raw = graphData.reduce((max, d) => Math.max(max, Math.abs(d.v)), 0) || 1;
    const maxV = Math.ceil(maxV_raw * 1.1 / 2) * 2;
    const maxX = P.L;

    ctx.fillStyle = '#003366';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';

    const V_START_Y = graphY + padding / 2;
    const GRAPH_HEIGHT = (graphH - padding) / 2;
    const X_START_Y = V_START_Y + GRAPH_HEIGHT + padding / 2;

    function drawAxisAndGrid(startY, height, maxValue, labelY) {
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 1;
        ctx.strokeRect(padding, startY, chartAreaW, height);

        ctx.textAlign = 'right';
        ctx.fillText(labelY, padding - 15, startY + 5);

        ctx.textAlign = 'center';
        ctx.fillText('t, с', padding + chartAreaW / 2, H - 5);

        const yTicks = 5;
        for (let i = 0; i <= yTicks; i++) {
            const value = maxValue * (i / yTicks);
            const y = startY + height * (1 - (i / yTicks));

            if (i > 0) {
                ctx.beginPath();
                ctx.moveTo(padding, y);
                ctx.lineTo(padding + chartAreaW, y);
                ctx.strokeStyle = '#eee';
                ctx.stroke();
            }

            ctx.fillStyle = '#333';
            ctx.textAlign = 'right';
            ctx.fillText(value.toFixed(1), padding - 5, y + 4);
        }

        const xTicks = Math.min(Math.ceil(maxTime / 2), 5) * 2;
        for (let i = 0; i <= xTicks; i++) {
            const timeValue = maxTime * (i / xTicks);
            const x = padding + chartAreaW * (i / xTicks);

            if (labelY === 'X(t), м' && i > 0 && i < xTicks) {
                ctx.beginPath();
                ctx.moveTo(x, startY);
                ctx.lineTo(x, startY + height);
                ctx.strokeStyle = '#eee';
                ctx.stroke();
            }

            ctx.fillStyle = '#333';
            ctx.textAlign = 'center';
            ctx.fillText(timeValue.toFixed(1), x, X_START_Y + GRAPH_HEIGHT + 15);
        }
    }

    const V_SCALE_HEIGHT = GRAPH_HEIGHT;
    drawAxisAndGrid(V_START_Y, V_SCALE_HEIGHT, maxV, 'V(t), м/с');
    drawAxisAndGrid(X_START_Y, GRAPH_HEIGHT, maxX, 'X(t), м');

    function drawCurve(data, startY, height, maxValue, color, isVelocity) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;

        const mapY = (value) => startY + height - (value / maxValue) * height;

        data.forEach((d, i) => {
            const x = padding + (d.t / maxTime) * chartAreaW;
            const y_value = isVelocity ? d.v : d.x;
            const y = mapY(y_value);

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();
    }

    drawCurve(graphData, X_START_Y, GRAPH_HEIGHT, maxX, '#0066cc', false);

    const analyticDataX = graphData
        .filter(d => d.t >= phaseTransitions[0]?.time || 0)
        .map(d => {
            const t_prime = d.t - (phaseTransitions[0]?.time || 0);
            return {
                t: d.t,
                x: analyticalSolution(t_prime).position
            };
        });
    drawCurve(analyticDataX, X_START_Y, GRAPH_HEIGHT, maxX, '#FF7F50', false);
    drawCurve(graphData, V_START_Y, V_SCALE_HEIGHT, maxV, '#0066cc', true);

    const analyticDataV = analyticDataX.map(d => {
        const t_prime = d.t - (phaseTransitions[0]?.time || 0);
        return {
            t: d.t,
            v: analyticalSolution(t_prime).velocity
        };
    });
    drawCurve(analyticDataV, V_START_Y, V_SCALE_HEIGHT, maxV, '#FF7F50', true);

    phaseTransitions.forEach(pt => {
        const x_coord = padding + (pt.t / maxTime) * chartAreaW;

        ctx.strokeStyle = pt.type === 'start' ? 'green' : 'red';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(x_coord, V_START_Y);
        ctx.lineTo(x_coord, X_START_Y + GRAPH_HEIGHT);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = pt.type === 'start' ? 'green' : 'red';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(pt.type === 'start' ? 'Срыв' : 'Остановка', x_coord, V_START_Y - 5);
    });

    ctx.font = '12px Arial';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#003366';
    ctx.fillText('— Симуляция (Численное)', padding + 5, H - 5);
    ctx.fillStyle = '#0066cc';
    ctx.fillRect(padding - 10, H - 12, 10, 2);
    ctx.fillStyle = '#003366';
    ctx.fillText('— Аналитическое решение', padding + 150 + 5, H - 5);
    ctx.fillStyle = '#FF7F50';
    ctx.fillRect(padding + 150 - 10, H - 12, 10, 2);
}

function updateMetricsDisplay() {
    let friction_state;
    if (acceleration_x === 0 && velocity_x === 0) {
        friction_state = 'Покой';
    } else if (Math.abs(velocity_x) < 0.001 && acceleration_x !== 0) {
        friction_state = 'Срыв с места (начало движения)';
    } else {
        friction_state = 'Скольжение';
    }

    let F_driving = P.F_ext - M.F_gravity_x;
    let F_max_s = P.mu_s * M.F_normal;
    let stopping_test_result = '';
    if (inputs.stopping_test && inputs.stopping_test.checked && velocity_x === 0) {
        if (Math.abs(F_driving) <= F_max_s) {
            stopping_test_result = `F<sub>тяги</sub> < F<sub>тр.покоя</sub> (${Math.abs(F_driving).toFixed(2)} Н < ${F_max_s.toFixed(2)} Н). <strong>Тело не сдвинется.</strong>`;
        } else {
            stopping_test_result = `F<sub>тяги</sub> > F<sub>тр.покоя</sub> (${Math.abs(F_driving).toFixed(2)} Н > ${F_max_s.toFixed(2)} Н). <strong>Тело начнет скользить.</strong>`;
        }
    }

    const energy_display = `
        <strong>Кинетическая энергия:</strong> ${M.E_kin.toFixed(2)} Дж |
        <strong>Работа F<sub>тр</sub>:</strong> ${M.W_friction_cum.toFixed(2)} Дж (Тепловая карта)
    `;

    if (visualHint) {
        visualHint.innerHTML = `
            <strong>Состояние трения:</strong> ${friction_state} | 
            <strong>F<sub>net</sub>:</strong> ${M.F_net.toFixed(2)} Н | 
            <strong>F<sub>тр</sub>:</strong> ${M.F_friction.toFixed(2)} Н <br>
            ${energy_display} <br>
            ${stopping_test_result}
        `;
    }
}

function animationLoop(timestamp) {
    if (!simulationRunning) return;
    if (!lastTimestamp) lastTimestamp = timestamp;

    let deltaTime = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    let stepsToRun = Math.floor(deltaTime / DT);
    stepsToRun = Math.min(stepsToRun, 5);

    for (let i = 0; i < stepsToRun; i++) {
        step(DT);
    }

    drawSimulation();
    updateMetricsDisplay();

    if (simulationRunning) {
        animationFrameId = requestAnimationFrame(animationLoop);
    }
}

function startSimulation() {
    const startBtn = document.getElementById('constant-force-start');
    const wasRunning = simulationRunning;

    if (wasRunning) {
        stopSimulation();
        return;
    }

    resetState();

    if (M.F_net === 0 && velocity_x === 0) {
        updateMetricsDisplay();
        return;
    }

    phaseTransitions.push({ time: totalTime, type: 'start' });
    initial_acceleration = acceleration_x;

    simulationRunning = true;
    if (startBtn) {
        startBtn.textContent = 'Остановить симуляцию';
        startBtn.classList.add('active-sim');
    }

    lastTimestamp = 0;
    animationFrameId = requestAnimationFrame(animationLoop);
}

function stopSimulation() {
    const startBtn = document.getElementById('constant-force-start');

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    simulationRunning = false;
    if (startBtn) {
        startBtn.textContent = 'Запуск симуляции';
        startBtn.classList.remove('active-sim');
    }
}

function setupEventListeners() {
    const startBtn = document.getElementById('constant-force-start');
    const resetBtn = document.getElementById('constant-force-reset');

    if (!startBtn || !resetBtn) return;

    startBtn.addEventListener('click', startSimulation);
    resetBtn.addEventListener('click', resetState);

    if (inputs.angle_presets) {
        inputs.angle_presets.addEventListener('change', () => {
            if (inputs.angle_custom) inputs.angle_custom.value = inputs.angle_presets.value;
            if (!simulationRunning) resetState();
        });
    }
    if (inputs.angle_custom) {
        inputs.angle_custom.addEventListener('input', () => {
            if (inputs.angle_presets) inputs.angle_presets.value = inputs.angle_custom.value;
            if (!simulationRunning) resetState();
        });
    }

    const controls = document.querySelectorAll('.controls-form input[type="range"]');
    controls.forEach(control => {
        control.addEventListener('input', () => {
            if (!simulationRunning) {
                updateParametersFromInputs();
                resetState();
            }
        });
    });

    document.querySelectorAll('.controls-form input[type="checkbox"]').forEach(control => {
        control.addEventListener('change', () => {
            if (!simulationRunning) {
                drawSimulation();
                updateMetricsDisplay();
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (canvas) {
        setupEventListeners();
        resetState();
    }
});