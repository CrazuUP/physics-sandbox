/**
 * js/modelirovanie-rychaga.js
 * Полнофункциональная интерактивная симуляция рычага
 * - начальное равновесие
 * - добавление/удаление произвольного числа грузов
 * - перетаскивание грузов и опоры (pointer events)
 * - динамика: покачивание с инерцией и демпфированием
 * - второй canvas: интерактивный график ΣM(t)
 * - кнопка "Вернуть в равновесие"
 *
 * Автор: сгенерировано ChatGPT
 */

(() => {
    'use strict';

    /* ===========================
       Конфигурация и константы
       =========================== */
    const G = 9.81; // м/с^2
    const METER_MIN = 0;
    const METER_MAX = 10;

    // Цветовая палитра для грузов
    const LOAD_COLORS = ['#ff6b6b','#ff7a59','#ffd166','#9bd770','#4aa3ff','#7c83fd','#a77bff','#62d2a2'];

    // Паддинги на канвасе (px)
    const PAD_L = 70;
    const PAD_R = 70;

    // Параметры динамики (можно менять для настройки "жёсткости" покачивания)
    const DEFAULT_BEAM_MASS = 2.0; // кг
    const DEFAULT_INERTIA = 5.0;
    const DEFAULT_DAMPING = 0.85;
    const MAX_GRAPH_POINTS = 2000;

    /* ===========================
       DOM элементы (существующие/создаваемые)
       =========================== */
    // Основной canvas в HTML
    let canvas = document.getElementById('lever-canvas');
    if (!canvas) {
        // Если нет, создаём и вставляем чуть выше footer
        canvas = document.createElement('canvas');
        canvas.id = 'lever-canvas';
        canvas.width = 900;
        canvas.height = 400;
        const container = document.querySelector('.simulation-area') || document.body;
        container.appendChild(canvas);
    }
    const ctx = canvas.getContext('2d');

    // outputs и inputs из HTML (если есть)
    const outMomentNet = document.getElementById('lever-moment-net-value');
    const outMechanicalWin = document.getElementById('lever-mechanical-win-value');
    const outRequiredForce = document.getElementById('lever-required-force-value');
    const outBalanceStatus = document.getElementById('lever-balance-status');

    const inpM1 = document.getElementById('lever-m1');
    const inpPos1 = document.getElementById('lever-pos1');
    const inpM2 = document.getElementById('lever-m2');
    const inpPos2 = document.getElementById('lever-pos2');
    const inpFulcrum = document.getElementById('lever-fulcrum-pos');

    const btnCheck = document.getElementById('lever-start');
    const btnReset = document.getElementById('lever-reset');

    // Создадим второй canvas для графика, если его нет
    let graphCanvas = document.getElementById('moment-graph-canvas');
    if (!graphCanvas) {
        const wrapper = document.createElement('section');
        wrapper.className = 'simulation-area';
        wrapper.style.padding = '12px';
        wrapper.innerHTML = `<h3>График момента во времени</h3>`;
        graphCanvas = document.createElement('canvas');
        graphCanvas.id = 'moment-graph-canvas';
        graphCanvas.width = 900;
        graphCanvas.height = 220;
        graphCanvas.className = 'simulation-canvas';
        wrapper.appendChild(graphCanvas);
        // поместить после основного canvas
        canvas.parentNode.insertBefore(wrapper, canvas.nextSibling);
    }
    const gctx = graphCanvas.getContext('2d');

    // Панель управления грузами и кнопками (создадим, если нет)
    let weightsPanel = document.getElementById('weights-panel');
    if (!weightsPanel) {
        weightsPanel = document.createElement('section');
        weightsPanel.className = 'controls';
        weightsPanel.id = 'weights-panel';
        weightsPanel.style.marginTop = '12px';
        weightsPanel.innerHTML = `
      <h3>Управление грузами</h3>
      <div id="weights-controls" style="display:flex;gap:12px;flex-wrap:wrap;">
        <button id="add-weight-btn" class="action-btn">Добавить груз</button>
        <button id="toggle-sim-btn" class="action-btn">Пуск/Пауза динамики</button>
        <button id="restore-balance-btn" class="action-btn">Вернуть в равновесие</button>
        <button id="reset-sim-btn" class="action-btn">Сброс</button>
      </div>
      <div id="weights-list" style="margin-top:12px;"></div>
      <div style="margin-top:10px;color:#335c85;font-size:0.95rem;">
        Перетаскивайте грузы и опору мышью/пальцем. Двойной клик по балке — сбросить угол.
      </div>
    `;
        // вставим после graphCanvas wrapper
        graphCanvas.parentNode.parentNode.insertBefore(weightsPanel, graphCanvas.parentNode.nextSibling);
    }

    const addWeightBtn = document.getElementById('add-weight-btn');
    const toggleSimBtn = document.getElementById('toggle-sim-btn');
    const restoreBalanceBtn = document.getElementById('restore-balance-btn');
    const resetSimBtn = document.getElementById('reset-sim-btn');
    const weightsListNode = document.getElementById('weights-list');

    /* ===========================
       Вспомогательные функции размеров
       =========================== */
    function getCanvasSize(cnv) {
        const rect = cnv.getBoundingClientRect();
        return { w: rect.width, h: rect.height, left: rect.left, top: rect.top };
    }

    function fitCanvasToContainer(cnv, heightPx = null) {
        const rect = cnv.getBoundingClientRect();
        const DPR = Math.max(1, window.devicePixelRatio || 1);
        const w = Math.round(rect.width * DPR);
        const h = Math.round((heightPx ? heightPx * DPR : rect.height * DPR));
        cnv.width = w;
        cnv.height = h;
        if (heightPx) cnv.style.height = (heightPx) + 'px';
        cnv.style.width = rect.width + 'px';
    }

    function metersToPx(m, cnv = canvas) {
        const { w } = getCanvasSize(cnv);
        const usable = w - PAD_L - PAD_R;
        const ratio = (m - METER_MIN) / (METER_MAX - METER_MIN);
        return PAD_L + ratio * usable;
    }
    function pxToMeters(px, cnv = canvas) {
        const { w } = getCanvasSize(cnv);
        const usable = w - PAD_L - PAD_R;
        const clamped = Math.max(PAD_L, Math.min(w - PAD_R, px));
        const ratio = (clamped - PAD_L) / usable;
        return METER_MIN + ratio * (METER_MAX - METER_MIN);
    }

    window.addEventListener('resize', () => {
        fitAll();
        drawScene(true);
        drawGraph();
    });

    function fitAll() {
        // Подогнать оба canvas
        try {
            fitCanvasToContainer(canvas);
            fitCanvasToContainer(graphCanvas, 220);
        } catch (e) {}
    }
    fitAll();

    /* ===========================
       Классы: Load, LeverModel
       =========================== */
    class Load {
        constructor(id, mass, x, color) {
            this.id = id;
            this.mass = mass;
            this.x = x; // метры от левого края шкалы
            this.color = color;
            this.radius = 16;
        }
        get force() { return this.mass * G; }
        moment(fulcrum) { return (this.x - fulcrum) * this.force; } // N·m, sign included
    }

    class LeverModel {
        constructor() {
            this.length = 10; // м
            this.fulcrum = 5; // м
            this.loads = [];
            this.nextId = 1;
            // динамика
            this.beamMass = DEFAULT_BEAM_MASS;
            this.inertia = DEFAULT_INERTIA; // распоряжение
            this.damping = DEFAULT_DAMPING;
            this.theta = 0; // угол (рад)
            this.omega = 0; // угловая скорость
            this.onUpdate = () => {};
        }

        addLoad(mass=1, x=5, color=null) {
            const id = this.nextId++;
            const c = color || LOAD_COLORS[(id-1) % LOAD_COLORS.length];
            const l = new Load(id, mass, Math.max(METER_MIN, Math.min(METER_MAX, x)), c);
            this.loads.push(l);
            this.onUpdate();
            return l;
        }

        removeLoad(id) {
            const idx = this.loads.findIndex(s => s.id === id);
            if (idx >= 0) {
                this.loads.splice(idx, 1);
                this.onUpdate();
            }
        }

        computeTotalMoment() {
            // sum of moments from point masses + beam's own weight (approx as point at center)
            let M = 0;
            for (const L of this.loads) M += L.moment(this.fulcrum);
            // beam weight (approx)
            const d = (this.length / 2 - this.fulcrum);
            M += (- d * (this.beamMass * G)); // sign consistent: negative means clockwise if d positive
            return M;
        }

        isBalanced(eps = 0.05) {
            return Math.abs(this.computeTotalMoment()) <= eps;
        }

        computeMechanicalAdvantage() {
            // for many loads approximate as (avg left arm)/(avg right arm)
            let leftSum = 0, leftCount = 0, rightSum = 0, rightCount = 0;
            for (const L of this.loads) {
                const r = L.x - this.fulcrum;
                if (r < 0) { leftSum += Math.abs(r); leftCount++; }
                if (r > 0) { rightSum += Math.abs(r); rightCount++; }
            }
            if (rightCount === 0) return Infinity;
            if (leftCount === 0) return 0;
            const avgLeft = leftSum / leftCount;
            const avgRight = rightSum / rightCount;
            return avgLeft / avgRight;
        }

        // вернуть в равновесие: попытаемся сдвинуть последний груз так, чтобы ΣM=0
        restoreBalance() {
            if (this.loads.length === 0) return;
            const movable = this.loads[this.loads.length - 1];
            // хотим найти x such that ΣM_without + (x - fulcrum)*movable.force = 0
            let M_others = 0;
            for (const L of this.loads) {
                if (L.id !== movable.id) M_others += L.moment(this.fulcrum);
            }
            const neededX = this.fulcrum - (M_others / movable.force);
            // Ограничиваем по границам балки
            movable.x = Math.max(METER_MIN, Math.min(METER_MAX, neededX));
            // Сброс динамики
            this.theta = 0;
            this.omega = 0;
            this.onUpdate();
        }

        // динамический шаг: используем малые dt (s)
        stepDynamics(dt) {
            // compute ΣM (approx using positions independent of theta for simplicity)
            const M = this.computeTotalMoment(); // N·m sign: positive -> anticlockwise
            // angular acceleration alpha = M / I
            // approximate I = inertia + sum(m_i * r^2)
            let I = this.inertia;
            for (const L of this.loads) {
                const r = (L.x - this.fulcrum);
                I += L.mass * r * r;
            }
            // beam contribution included in inertia base and moment computed above
            const alpha = M / I;
            // integrate (semi-implicit Euler)
            this.omega += alpha * dt;
            this.omega *= this.damping; // damping factor per step
            this.theta += this.omega * dt;
            // small-stability: clamp very small values
            if (Math.abs(this.omega) < 1e-6 && Math.abs(M) < 1e-3) {
                this.omega = 0;
                // gently bring theta toward 0
                this.theta *= 0.995;
            }
            this.onUpdate();
            return {M, I, alpha};
        }
    }

    /* ===========================
       Инициализация модели и стартовые грузы в равновесии
       =========================== */
    const model = new LeverModel();
    model.onUpdate = () => {
        updateWeightControls();
        updateOutputs();
        drawScene();
    };

    // если в HTML заданы значения initial, использовать их
    function initBalancedStartingState() {
        // Default masses/positions
        let m1 = 10, x1 = 3;
        let m2 = 5, x2 = 8;
        // Try to read from inputs if present
        try {
            if (inpM1) m1 = parseFloat(inpM1.value || inpM1.defaultValue) || m1;
            if (inpPos1) x1 = parseFloat(inpPos1.value || inpPos1.defaultValue) || x1;
            if (inpM2) m2 = parseFloat(inpM2.value || inpM2.defaultValue) || m2;
            if (inpPos2) x2 = parseFloat(inpPos2.value || inpPos2.defaultValue) || x2;
            if (inpFulcrum) model.fulcrum = parseFloat(inpFulcrum.value || inpFulcrum.defaultValue) || model.fulcrum;
        } catch (e) {}
        // Ensure x1 is left of fulcrum; if not adjust
        if (x1 >= model.fulcrum) x1 = Math.max(METER_MIN, model.fulcrum - 1);
        // Compute x2 to produce balance: m1 * (fulcrum - x1) = m2 * (x2 - fulcrum) => x2 = fulcrum + m1*(fulcrum - x1)/m2
        const x2_calculated = model.fulcrum + (m1 * (model.fulcrum - x1)) / m2;
        model.loads.length = 0;
        model.addLoad(m1, x1, LOAD_COLORS[0]);
        model.addLoad(m2, Math.max(METER_MIN, Math.min(METER_MAX, x2_calculated)), LOAD_COLORS[1]);
        // set initial theta/omega 0
        model.theta = 0;
        model.omega = 0;
    }
    initBalancedStartingState();

    /* ===========================
       UI: управление грузами (динамическая панель)
       =========================== */
    function createWeightRow(L) {
        // row: color dot, m input, x input, remove button
        const row = document.createElement('div');
        row.id = 'weight-row-' + L.id;
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.marginBottom = '8px';
        row.innerHTML = `
      <div style="width:12px;height:12px;background:${L.color};border-radius:50%;"></div>
      <label style="width:46px">m (кг)</label>
      <input type="number" id="w-m-${L.id}" value="${L.mass}" min="0.1" step="0.1" style="width:90px"/>
      <label style="width:46px">x (м)</label>
      <input type="number" id="w-x-${L.id}" value="${L.x.toFixed(2)}" min="${METER_MIN}" max="${METER_MAX}" step="0.01" style="width:90px"/>
      <button id="w-remove-${L.id}" class="action-btn" style="padding:4px 8px">Удалить</button>
    `;
        return row;
    }

    function updateWeightControls() {
        // Перестроить список контролов (просто пересоздаём)
        weightsListNode.innerHTML = '';
        for (const L of model.loads) {
            const row = createWeightRow(L);
            weightsListNode.appendChild(row);
            // hook inputs
            const mInp = document.getElementById('w-m-' + L.id);
            const xInp = document.getElementById('w-x-' + L.id);
            const rmBtn = document.getElementById('w-remove-' + L.id);
            if (mInp) {
                mInp.addEventListener('input', (e) => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isNaN(v) && v > 0) L.mass = v;
                    updateOutputs();
                    drawScene();
                });
            }
            if (xInp) {
                xInp.addEventListener('input', (e) => {
                    let v = parseFloat(e.target.value);
                    if (Number.isNaN(v)) return;
                    v = Math.max(METER_MIN, Math.min(METER_MAX, v));
                    L.x = v;
                    updateOutputs();
                    drawScene();
                });
            }
            if (rmBtn) {
                rmBtn.addEventListener('click', () => {
                    model.removeLoad(L.id);
                });
            }
        }
    }
    updateWeightControls();

    // Events for Add / Toggle / Restore / Reset
    if (addWeightBtn) {
        addWeightBtn.addEventListener('click', () => {
            // добавляем груз рядом с опорой (если возможно)
            const pos = Math.max(METER_MIN, Math.min(METER_MAX, model.fulcrum + 1));
            model.addLoad(1.0, pos, LOAD_COLORS[(model.nextId-1) % LOAD_COLORS.length]);
            // запомним состояния
            drawScene(true);
        });
    }

    let dynamicsRunning = true;
    if (toggleSimBtn) {
        toggleSimBtn.textContent = 'Пауза динамики';
        toggleSimBtn.addEventListener('click', () => {
            dynamicsRunning = !dynamicsRunning;
            toggleSimBtn.textContent = dynamicsRunning ? 'Пауза динамики' : 'Возобновить динамику';
            if (dynamicsRunning) lastTime = performance.now(), raf();
        });
    }

    if (restoreBalanceBtn) {
        restoreBalanceBtn.addEventListener('click', () => {
            model.restoreBalance();
            // синхронизируем UI inputs для первого двух грузов, если они существуют
            for (const L of model.loads) {
                const xi = document.getElementById('w-x-' + L.id);
                const mi = document.getElementById('w-m-' + L.id);
                if (xi) xi.value = L.x.toFixed(2);
                if (mi) mi.value = L.mass;
            }
            drawScene(true);
        });
    }

    if (resetSimBtn) {
        resetSimBtn.addEventListener('click', () => {
            // вернём начальное равновесие
            initBalancedStartingState();
            updateWeightControls();
            model.theta = 0; model.omega = 0;
            graphData.length = 0;
            drawScene(true);
            drawGraph();
        });
    }

    if (btnCheck) {
        btnCheck.addEventListener('click', () => {
            // показать статус равновесия (обновление полей уже делает updateOutputs)
            updateOutputs();
            drawScene(true);
        });
    }
    if (btnReset) {
        btnReset.addEventListener('click', () => {
            resetSimBtn.click();
        });
    }

    /* ===========================
       Pointer interaction: drag loads and fulcrum
       =========================== */
    let dragging = null; // {type: 'load'|'fulcrum', id}
    function findHitTarget(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const { w, h } = getCanvasSize(canvas);
        const beamY = h * 0.45;
        // check loads
        for (const L of model.loads) {
            const px = metersToPx(L.x);
            const py = beamY + 28;
            const d = Math.hypot(px - x, py - y);
            if (d <= Math.max(18, L.radius + 4)) return {type: 'load', id: L.id};
        }
        // check fulcrum
        const fulPx = metersToPx(model.fulcrum);
        const dF = Math.hypot(fulPx - x, beamY - y);
        if (dF <= 28) return {type: 'fulcrum'};
        return null;
    }

    canvas.addEventListener('pointerdown', (ev) => {
        canvas.setPointerCapture(ev.pointerId);
        const hit = findHitTarget(ev.clientX, ev.clientY);
        if (hit) {
            dragging = hit;
            // stop dynamics while dragging for accuracy
            model.omega = 0;
            dynamicsRunning = false;
            if (toggleSimBtn) toggleSimBtn.textContent = 'Возобновить динамику';
            drawScene();
        }
    });

    canvas.addEventListener('pointermove', (ev) => {
        if (!dragging) return;
        const rect = canvas.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const m = pxToMeters(x);
        const clamped = Math.max(METER_MIN, Math.min(METER_MAX, +m.toFixed(2)));
        if (dragging.type === 'fulcrum') {
            model.fulcrum = clamped;
            if (inpFulcrum) inpFulcrum.value = model.fulcrum;
        } else if (dragging.type === 'load') {
            const L = model.loads.find(z => z.id === dragging.id);
            if (L) {
                L.x = clamped;
                const xInp = document.getElementById('w-x-' + L.id);
                if (xInp) xInp.value = L.x.toFixed(2);
            }
        }
        updateOutputs();
        drawScene();
    });

    canvas.addEventListener('pointerup', (ev) => {
        if (dragging) {
            dragging = null;
            // resume dynamics
            dynamicsRunning = true;
            if (toggleSimBtn) toggleSimBtn.textContent = 'Пауза динамики';
            // ensure update UI
            updateWeightControls();
            updateOutputs();
            drawScene();
            lastTime = performance.now();
            raf();
        }
        try { canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
    });

    canvas.addEventListener('pointercancel', () => {
        dragging = null;
    });

    canvas.addEventListener('dblclick', () => {
        // сбросить угол
        model.theta = 0; model.omega = 0;
        drawScene(true);
    });

    /* ===========================
       Рисование сцены (балка, опора, грузы, подписи)
       =========================== */
    function clearMainCanvas() {
        const { w, h } = getCanvasSize(canvas);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,w,h);
    }

    function roundRect(ctxLocal, x, y, w, h, r) {
        ctxLocal.beginPath();
        ctxLocal.moveTo(x + r, y);
        ctxLocal.arcTo(x + w, y, x + w, y + h, r);
        ctxLocal.arcTo(x + w, y + h, x, y + h, r);
        ctxLocal.arcTo(x, y + h, x, y, r);
        ctxLocal.arcTo(x, y, x + w, y, r);
        ctxLocal.closePath();
    }

    function drawScene(forceImmediate=false) {
        if (!canvas || !ctx || !model) return;
        fitCanvasToContainer(canvas);
        clearMainCanvas();
        const { w, h } = getCanvasSize(canvas);
        const fulPx = metersToPx(model.fulcrum);
        const beamY = h * 0.45;
        // shadow
        ctx.fillStyle = 'rgba(0,0,0,0.03)';
        roundRect(ctx, PAD_L - 30, beamY + 50, (w - PAD_L - PAD_R) + 60, 18, 8);
        ctx.fill();

        // draw fulcrum (triangle)
        ctx.save();
        ctx.translate(fulPx, beamY + 2);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-28, 36);
        ctx.lineTo(28, 36);
        ctx.closePath();
        ctx.fillStyle = '#003366';
        ctx.fill();
        ctx.restore();

        // draw beam rotated by theta around fulcrum
        ctx.save();
        ctx.translate(fulPx, beamY);
        ctx.rotate(model.theta);
        const leftX = PAD_L - fulPx;
        const width = (getCanvasSize(canvas).w - PAD_R) - PAD_L;
        const thickness = 14;
        // gradient
        const grad = ctx.createLinearGradient(leftX, 0, leftX + width, 0);
        grad.addColorStop(0, '#f0f9ff');
        grad.addColorStop(0.5, '#cfe8ff');
        grad.addColorStop(1, '#f0f9ff');
        ctx.fillStyle = grad;
        roundRect(ctx, leftX, -thickness/2, width, thickness, 8);
        ctx.fill();

        // scale marks
        ctx.strokeStyle = 'rgba(0,0,0,0.09)';
        ctx.lineWidth = 1;
        ctx.font = '12px Arial';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        for (let m = METER_MIN; m <= METER_MAX; m++) {
            const px = metersToPx(m) - fulPx;
            ctx.beginPath();
            ctx.moveTo(px, thickness/2 + 4);
            ctx.lineTo(px, thickness/2 + 12);
            ctx.stroke();
            if (m % 1 === 0) {
                ctx.save();
                ctx.translate(px, thickness/2 + 26);
                ctx.rotate(-model.theta);
                ctx.fillText(m.toFixed(0) + ' м', -10, 0);
                ctx.restore();
            }
        }
        // draw loads (attached to beam coordinates)
        for (const L of model.loads) {
            // position relative to fulcrum in px
            const px = metersToPx(L.x) - fulPx;
            const yTop = -thickness/2 - 24;
            ctx.save();
            ctx.translate(px, yTop);
            // rope
            ctx.beginPath();
            ctx.moveTo(0, -0);
            ctx.lineTo(0, 24);
            ctx.strokeStyle = 'rgba(0,0,0,0.06)';
            ctx.lineWidth = 2;
            ctx.stroke();
            // disk
            ctx.beginPath();
            ctx.arc(0, 24, L.radius, 0, Math.PI*2);
            ctx.fillStyle = L.color;
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(0,0,0,0.12)';
            ctx.stroke();
            // label
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(L.mass.toFixed(1) + ' кг', 0, 24);
            ctx.restore();
        }

        // draw reaction arrow in beam coords
        ctx.beginPath();
        ctx.moveTo(0, thickness/2 + 6);
        ctx.lineTo(0, thickness/2 + 42);
        ctx.strokeStyle = 'rgba(10,122,47,0.95)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-6, thickness/2 + 18);
        ctx.lineTo(0, thickness/2 + 6);
        ctx.lineTo(6, thickness/2 + 18);
        ctx.fillStyle = 'rgba(10,122,47,0.95)';
        ctx.fill();

        ctx.restore();

        // Draw dashed arms and labels (in world coords)
        ctx.setLineDash([6,6]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(0,80,140,0.75)';
        for (const L of model.loads) {
            const pxGlobal = metersToPx(L.x);
            ctx.beginPath();
            ctx.moveTo(fulPx, beamY);
            ctx.lineTo(pxGlobal, beamY);
            ctx.stroke();
            ctx.save();
            ctx.translate((fulPx + pxGlobal) / 2, beamY - 14);
            ctx.fillStyle = '#003366';
            ctx.font = '12px Arial';
            ctx.fillText(Math.abs(L.x - model.fulcrum).toFixed(2) + ' м', 0, 0);
            ctx.restore();
        }
        ctx.setLineDash([]);

        // Right panel info
        ctx.save();
        ctx.fillStyle = '#003366';
        ctx.font = '14px Arial';
        ctx.fillText('ΣM = ' + model.computeTotalMoment().toFixed(2) + ' Н·м', getCanvasSize(canvas).w - PAD_R - 220, 30);
        ctx.fillStyle = '#335c85';
        ctx.font = '13px Arial';
        ctx.fillText('θ = ' + (model.theta * 180 / Math.PI).toFixed(2) + '°', getCanvasSize(canvas).w - PAD_R - 220, 52);
        ctx.restore();
    }

    /* ===========================
       Обновление числовых полей
       =========================== */
    function updateOutputs() {
        const M = model.computeTotalMoment();
        if (outMomentNet) outMomentNet.value = M.toFixed(2);
        if (outMechanicalWin) {
            const K = model.computeMechanicalAdvantage();
            outMechanicalWin.value = Number.isFinite(K) ? K.toFixed(3) : '∞';
        }
        if (outRequiredForce) {
            // приближённая оценка требуемой силы слева для компенсации правой
            let rightMoment = 0;
            let leftArmSum = 0, leftCount = 0;
            for (const L of model.loads) {
                const r = L.x - model.fulcrum;
                if (r > 0) rightMoment += L.mass * G * r;
                if (r < 0) { leftArmSum += Math.abs(r); leftCount++; }
            }
            const avgLeft = leftCount > 0 ? leftArmSum / leftCount : 0;
            const req = (avgLeft > 1e-6) ? (rightMoment / avgLeft) : 0;
            outRequiredForce.value = req > 0 ? req.toFixed(2) : '0.00';
        }
        if (outBalanceStatus) {
            if (model.isBalanced(0.05)) {
                outBalanceStatus.textContent = 'РАВНОВЕСИЕ';
                outBalanceStatus.style.color = '#0a7a2f';
            } else {
                const s = model.computeTotalMoment() > 0 ? 'ПОВОРОТ ПРОТИВ ЧАСОВОЙ' : 'ПОВОРОТ ПО ЧАСОВОЙ';
                outBalanceStatus.textContent = s;
                outBalanceStatus.style.color = '#d9534f';
            }
        }
    }

    /* ===========================
       График ΣM(t)
       =========================== */
    const graphData = []; // {t: ms, M: N·m}
    function drawGraph() {
        fitCanvasToContainer(graphCanvas, 220);
        const { w, h } = getCanvasSize(graphCanvas);
        gctx.clearRect(0, 0, w, h);
        gctx.fillStyle = '#fcfdff';
        gctx.fillRect(0,0,w,h);

        const pad = 40;
        const plotW = w - pad * 1.5;
        const plotH = h - pad * 1.2;
        const plotX = pad/2;
        const plotY = pad/4;
        // border
        gctx.strokeStyle = 'rgba(0,0,0,0.08)';
        roundRect(gctx, plotX, plotY, plotW, plotH, 6);
        gctx.stroke();

        if (graphData.length < 2) {
            gctx.fillStyle = '#335c85';
            gctx.font = '13px Arial';
            gctx.fillText('График ΣM(t) — данных пока нет', plotX + 8, plotY + 20);
            return;
        }

        // Time window last T ms
        const T = 10000;
        const now = performance.now();
        const start = now - T;
        const visible = graphData.filter(p => p.t >= start);
        if (visible.length < 2) return;

        let maxAbs = 1;
        for (const v of visible) maxAbs = Math.max(maxAbs, Math.abs(v.M));
        const scaleY = (plotH * 0.45) / maxAbs;

        // grid lines
        gctx.strokeStyle = 'rgba(0,0,0,0.03)';
        for (let i = 0; i <= 4; i++) {
            const y = plotY + (i/4) * plotH;
            gctx.beginPath();
            gctx.moveTo(plotX + 6, y);
            gctx.lineTo(plotX + plotW - 6, y);
            gctx.stroke();
        }

        // line
        gctx.beginPath();
        for (let i = 0; i < visible.length; i++) {
            const p = visible[i];
            const x = plotX + ((p.t - start) / T) * plotW;
            const y = plotY + plotH/2 - p.M * scaleY;
            if (i === 0) gctx.moveTo(x, y); else gctx.lineTo(x, y);
        }
        gctx.lineWidth = 2;
        gctx.strokeStyle = '#4aa3ff';
        gctx.stroke();

        // last point
        const last = visible[visible.length - 1];
        const lx = plotX + ((last.t - start) / T) * plotW;
        const ly = plotY + plotH/2 - last.M * scaleY;
        gctx.beginPath();
        gctx.arc(lx, ly, 4, 0, Math.PI*2);
        gctx.fillStyle = '#ff6b6b';
        gctx.fill();
        gctx.fillStyle = '#003366';
        gctx.font = '12px Arial';
        gctx.fillText(last.M.toFixed(2) + ' Н·м', lx + 8, ly - 8);
    }

    // wheel zoom/pan for graph: simple vertical scroll disabled, horizontal scroll changes offset? (basic)
    graphCanvas.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        // no-op for now (kept for extension)
    });

    /* ===========================
       Главный цикл анимации
       =========================== */
    let lastTime = performance.now();
    let rafId = null;

    function raf(now = performance.now()) {
        if (!dynamicsRunning) return;
        const dt = Math.min(0.04, (now - lastTime) / 1000); // s
        lastTime = now;

        // Integrate dynamics with sub-steps for stability
        let left = dt;
        while (left > 0) {
            const step = Math.min(left, 1/120);
            const info = model.stepDynamics(step);
            left -= step;
            // collect graph point
            graphData.push({ t: performance.now(), M: info.M });
            if (graphData.length > MAX_GRAPH_POINTS) graphData.splice(0, graphData.length - MAX_GRAPH_POINTS);
        }

        // draw
        drawScene();
        updateOutputs();
        drawGraph();

        rafId = requestAnimationFrame(raf);
    }

    // start animation
    lastTime = performance.now();
    rafId = requestAnimationFrame(raf);

    /* ===========================
       Синхронизация со старой формой (если есть)
       =========================== */
    // если у пользователя были ползунки lever-m1 etc, синхронизируем с первыми двумя грузами
    if (inpM1) {
        inpM1.addEventListener('input', (e) => {
            if (model.loads[0]) {
                model.loads[0].mass = parseFloat(e.target.value);
                const mInp = document.getElementById('w-m-' + model.loads[0].id);
                if (mInp) mInp.value = model.loads[0].mass;
            }
        });
    }
    if (inpPos1) {
        inpPos1.addEventListener('input', (e) => {
            if (model.loads[0]) {
                model.loads[0].x = parseFloat(e.target.value);
                const xInp = document.getElementById('w-x-' + model.loads[0].id);
                if (xInp) xInp.value = model.loads[0].x;
                updateOutputs(); drawScene();
            }
        });
    }
    if (inpM2) {
        inpM2.addEventListener('input', (e) => {
            if (model.loads[1]) {
                model.loads[1].mass = parseFloat(e.target.value);
                const mInp = document.getElementById('w-m-' + model.loads[1].id);
                if (mInp) mInp.value = model.loads[1].mass;
            }
        });
    }
    if (inpPos2) {
        inpPos2.addEventListener('input', (e) => {
            if (model.loads[1]) {
                model.loads[1].x = parseFloat(e.target.value);
                const xInp = document.getElementById('w-x-' + model.loads[1].id);
                if (xInp) xInp.value = model.loads[1].x;
                updateOutputs(); drawScene();
            }
        });
    }
    if (inpFulcrum) {
        inpFulcrum.addEventListener('input', (e) => {
            model.fulcrum = parseFloat(e.target.value);
            updateOutputs(); drawScene();
        });
    }

    /* ===========================
       Сохранение/восстановление состояния (локально)
       =========================== */
    function saveStateToLocal() {
        try {
            const s = {
                fulcrum: model.fulcrum,
                loads: model.loads.map(L => ({mass: L.mass, x: L.x, color: L.color})),
                theta: model.theta,
                omega: model.omega
            };
            localStorage.setItem('lever_sim_state_v2', JSON.stringify(s));
        } catch (e) {}
    }
    function loadStateFromLocal() {
        try {
            const s = JSON.parse(localStorage.getItem('lever_sim_state_v2'));
            if (!s) return false;
            model.loads.length = 0;
            for (const w of s.loads) model.addLoad(w.mass, w.x, w.color);
            model.fulcrum = s.fulcrum || model.fulcrum;
            model.theta = s.theta || 0;
            model.omega = s.omega || 0;
            updateWeightControls();
            updateOutputs();
            drawScene(true);
            drawGraph();
            return true;
        } catch (e) { return false; }
    }
    loadStateFromLocal();
    window.addEventListener('beforeunload', saveStateToLocal);

    /* ===========================
       Начальные действия: гарантия равновесия при старте
       =========================== */
    // Если модель не в равновесии, скорректируем второй груз
    if (!model.isBalanced(0.05) && model.loads.length >= 2) {
        // try to reposition last load to balance
        model.restoreBalance();
    }
    updateWeightControls();
    updateOutputs();
    drawScene(true);
    drawGraph();

    /* ===========================
       Экспорт функций (опционально)
       =========================== */
    // Примеры: можно вызвать model.restoreBalance() в консоли, или model.addLoad(...)
    window.leverSim = {
        model,
        drawScene,
        drawGraph,
        addLoad: (m,x,c) => model.addLoad(m,x,c),
        restoreBalance: () => model.restoreBalance()
    };

    /* ===========================
       Конец модуля
       =========================== */
})();
