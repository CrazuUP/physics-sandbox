document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('constant-force-canvas');
    const ctx = canvas.getContext('2d');
    const heatmapLegend = document.getElementById('heatmap-legend');

    // --- УПРАВЛЕНИЕ INPUTS (СВЯЗКА RANGE <-> NUMBER) ---
    const params = {
        mass: { val: 5, range: 'input-mass-range', num: 'input-mass-num' },
        force: { val: 80, range: 'input-force-range', num: 'input-force-num' },
        friction_static: { val: 0.3, range: 'input-friction-static-range', num: 'input-friction-static-num' },
        friction_kinetic: { val: 0.2, range: 'input-friction-kinetic-range', num: 'input-friction-kinetic-num' },
        angle: { val: 0, range: 'input-angle-range', num: 'input-angle-num' },
        length: { val: 20, range: 'input-length-range', num: 'input-length-num' },
        startPos: { val: 0, range: 'input-start-range', num: 'input-start-num' }
    };

    const checkboxes = {
        vectors: document.getElementById('check-vectors'),
        graphs: document.getElementById('check-graphs'),
        heatmap: document.getElementById('check-heatmap')
    };

    const btnStart = document.getElementById('btn-start');
    const btnReset = document.getElementById('btn-reset');

    // Гравитация
    const G = 9.81;

    // Инициализация слушателей для двойных инпутов
    Object.keys(params).forEach(key => {
        const p = params[key];
        const rangeEl = document.getElementById(p.range);
        const numEl = document.getElementById(p.num);

        if (!rangeEl || !numEl) {
            // Элемент управления не найден
            return;
        }

        // При изменении ползунка
        rangeEl.addEventListener('input', () => {
            p.val = parseFloat(rangeEl.value);
            numEl.value = p.val;
            if (key === 'length') validateStartPos();
            if(!sim.running) drawScene();
        });

        // При изменении числа
        numEl.addEventListener('input', () => {
            p.val = parseFloat(numEl.value);
            rangeEl.value = p.val;
            if (key === 'length') validateStartPos();
            if(!sim.running) drawScene();
        });

        // Инициализация значений из params
        rangeEl.value = p.val;
        numEl.value = p.val;
    });

    // Ограничиваем X0, чтобы не было больше длины пути
    function validateStartPos() {
        const len = params.length.val;
        const startNum = document.getElementById(params.startPos.num);
        const startRange = document.getElementById(params.startPos.range);

        if (startNum && startRange) {
            startNum.max = len;
            startRange.max = len;

            if (params.startPos.val > len) {
                params.startPos.val = len;
                startNum.value = len;
                startRange.value = len;
            }
        }

        if (sim.t === 0 && !sim.running) {
            sim.x = params.startPos.val;
            drawScene();
        }
    }

    // Инициализация чекбоксов
    if (checkboxes.heatmap) {
        heatmapLegend.style.display = checkboxes.heatmap.checked ? 'flex' : 'none';
        checkboxes.heatmap.addEventListener('change', () => {
            heatmapLegend.style.display = checkboxes.heatmap.checked ? 'flex' : 'none';
            drawScene();
        });
    }

    // --- ФИЗИКА ---
    const sim = {
        running: false,
        finished: false,
        t: 0,
        x: 0,
        v: 0,
        a: 0,
        totalFrictionWork: 0,
        lastFrameTime: 0,
        history: [],
        trail: []
    };

    // Начальная установка
    validateStartPos(); // Устанавливает sim.x

    if (checkboxes.heatmap && checkboxes.heatmap.checked) {
        heatmapLegend.style.display = 'flex';
    }

    function resetSim() {
        sim.running = false;
        sim.finished = false;
        sim.t = 0;
        sim.x = params.startPos.val;
        sim.v = 0;
        sim.a = 0;
        sim.totalFrictionWork = 0;
        sim.history = [];
        sim.trail = [];
        btnStart.textContent = "Запуск";
        drawScene();
    }

    function updatePhysics(dt) {
        if (sim.finished) return;

        const m = params.mass.val;
        const F_pull = params.force.val;
        const mu_static = params.friction_static.val;
        const mu_kinetic = params.friction_kinetic.val;
        const angleRad = params.angle.val * Math.PI / 180;

        const F_gravity_parallel = m * G * Math.sin(angleRad);
        const N = m * G * Math.cos(angleRad);
        const F_friction_max_static = mu_static * N;
        const F_friction_max_kinetic = mu_kinetic * N;

        let F_net_driving = F_pull - F_gravity_parallel;
        let F_friction = 0;

        if (Math.abs(sim.v) < 0.001) {
            if (Math.abs(F_net_driving) <= F_friction_max_static) {
                sim.v = 0;
                sim.a = 0;
                F_friction = F_net_driving;
            } else {
                F_friction = F_friction_max_kinetic * Math.sign(F_net_driving);
                sim.a = (F_net_driving - F_friction) / m;
            }
        } else {
            F_friction = F_friction_max_kinetic * Math.sign(sim.v);
            sim.a = (F_net_driving - F_friction) / m;
        }

        sim.v += sim.a * dt;
        sim.x += sim.v * dt;
        sim.totalFrictionWork += Math.abs(F_friction * sim.v) * dt;
        sim.t += dt;

        if (sim.t % 0.1 < dt) {
            sim.history.push({ t: sim.t, x: sim.x, v: sim.v, work: sim.totalFrictionWork });
        }

        const frictionPower = Math.abs(F_friction * sim.v);
        sim.trail.push({ x: sim.x, intensity: frictionPower });

        if (sim.x >= params.length.val || sim.x < -1) {
            sim.finished = true;
            sim.running = false;
            btnStart.textContent = "Запуск";
        }
    }

    // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

    function getNiceStep(maxVal) {
        if (maxVal <= 0) return 1;
        const targetSteps = 10;
        const roughStep = maxVal / targetSteps;

        const power = Math.pow(10, Math.floor(Math.log10(roughStep)));
        const base = roughStep / power;

        let niceBase;
        if (base < 1.5) niceBase = 1;
        else if (base < 3.5) niceBase = 2;
        else if (base < 7.5) niceBase = 5;
        else niceBase = 10;

        return niceBase * power;
    }

    // --- ОТРИСОВКА СЦЕНЫ ---

    function drawScene() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const trackL = params.length.val;
        const angDeg = params.angle.val;
        const angRad = angDeg * Math.PI / 180;

        const GRAPH_SECTION_HEIGHT = 160;

        const topMargin = 10 + (checkboxes.graphs.checked ? GRAPH_SECTION_HEIGHT : 0);
        const bottomMargin = 50;

        const viewHeight = canvas.height - topMargin - bottomMargin;
        const viewWidth = canvas.width * 0.8;

        const cosA = Math.cos(angRad);
        const sinA = Math.sin(angRad);

        const projWidth = trackL * Math.cos(angRad);
        const projHeight = trackL * Math.abs(Math.sin(angRad));

        const scaleH = projWidth > 0 ? viewWidth / projWidth : Infinity;
        const scaleV = projHeight > 0 ? viewHeight / projHeight : Infinity;
        const scale = Math.min(scaleH, scaleV);

        const Ls = trackL * scale;

        // Вычисляем начальные координаты для центрирования наклонной плоскости
        const startY = topMargin + (viewHeight - Ls * sinA) / 2 + Ls * sinA;
        const viewXStart = (canvas.width - Ls * cosA) / 2;

        // --- ГРАФИКИ ---
        if (checkboxes.graphs.checked) {
            drawGraphs(ctx, canvas.width, 10);
        }

        // --- ОСНОВНАЯ СЦЕНА (Наклонная плоскость) ---

        ctx.save();
        ctx.translate(viewXStart, startY);
        ctx.rotate(-angRad);

        // Путь
        ctx.strokeStyle = '#003366';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.lineTo(trackL * scale + 10, 0);
        ctx.stroke();

        // Штрихи (деления)
        const step = getNiceStep(trackL);
        ctx.fillStyle = '#333';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';

        for (let x = 0; x <= trackL; x += step) {
            const px = x * scale;

            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, 10);
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.save();
            ctx.translate(px, 25);
            ctx.rotate(angRad);
            ctx.fillText(Math.round(x * 10) / 10, 0, 0);
            ctx.restore();
        }

        // Тепловая карта
        if (checkboxes.heatmap.checked && sim.trail.length > 1) {
            ctx.lineWidth = 8;
            ctx.lineCap = 'butt';

            for (let i = 0; i < sim.trail.length - 1; i++) {
                const p1 = sim.trail[i];
                const p2 = sim.trail[i+1];
                if (Math.abs(p2.x - p1.x) < 0.001) continue;

                let intensity = Math.min(p1.intensity / 500, 1);
                const hue = 240 - (intensity * 240);

                ctx.strokeStyle = `hsla(${hue}, 100%, 50%, 0.6)`;
                ctx.beginPath();
                ctx.moveTo(p1.x * scale, -2);
                ctx.lineTo(p2.x * scale, -2);
                ctx.stroke();
            }
        }

        // Брусок
        const boxW = 40;
        const boxH = 25;
        const currentPx = sim.x * scale;

        if (currentPx >= -50 && currentPx <= trackL * scale + 50) {
            ctx.fillStyle = '#0066cc';
            ctx.fillRect(currentPx, -boxH, boxW, boxH);

            // Векторы



            if (checkboxes.vectors.checked) {
                drawVectors(ctx, currentPx + boxW/2, -boxH/2, params, sim.v);
            }
        }

        ctx.restore();

        // Статистика
        const statsBlock = document.getElementById('stats-block');
        if (statsBlock) {
            statsBlock.innerHTML = `
    <p>t = ${sim.t.toFixed(2)} с</p>
    <p>x = ${sim.x.toFixed(2)} м</p>
    <p>v = ${sim.v.toFixed(2)} м/с</p>
    <p>Aтр = ${sim.totalFrictionWork.toFixed(0)} Дж</p>
    `;
        }
    }


    function drawVectors(ctx, cx, cy, p, v) {
        const m = p.mass.val;
        const ang = p.angle.val * Math.PI / 180;

        // mg (вертикально вниз относительно экрана)
        drawArrow(ctx, cx, cy, -50 * Math.sin(ang), 50 * Math.cos(ang), 'mg', '#333');

        // N (нормальная реакция) - немного меньше, если угол наклона ненулевой
        const N_len_factor = Math.cos(ang);
        drawArrow(ctx, cx, cy, 0, -40 * N_len_factor, 'N', '#28a745');

        // F (тяга)
        drawArrow(ctx, cx, cy, 50, 0, 'F', '#d35400');

        // Fтр (Трение)
        const F_net_driving = p.force.val - m * G * Math.sin(ang);

        if (Math.abs(v) > 0.001) {
            // Движение: трение против скорости
            const dir = v >= 0 ? -1 : 1;
            drawArrow(ctx, cx, cy + 10, dir * 35, 0, 'Fтр', '#dc3545');
        } else if (Math.abs(F_net_driving) > 0.001) {
            // Покой, но есть толкающая сила: трение против F_net
            const dir = Math.sign(F_net_driving) === 1 ? -1 : 1;
            drawArrow(ctx, cx, cy + 10, dir * 35, 0, 'Fтр', '#dc3545');
        }
    }

    function drawArrow(ctx, x, y, dx, dy, label, color) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx, y + dy);
        ctx.stroke();

        const head = 8;
        const angle = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx - head * Math.cos(angle - Math.PI/6), y + dy - head * Math.sin(angle - Math.PI/6));
        ctx.lineTo(x + dx - head * Math.cos(angle + Math.PI/6), y + dy - head * Math.sin(angle + Math.PI/6));
        ctx.fill();

        ctx.fillStyle = color;
        ctx.font = 'bold 12px Arial';
        ctx.fillText(label, x + dx + (dx>0?5:-25), y + dy + (dy>0?15:-5));

        ctx.restore();
    }

    // --- ОТРИСОВКА ГРАФИКОВ ---
    function drawGraphs(ctx, w, h) {
        const gw = 260;
        const gh = 120;
        const pad = 30;
        let gx = 35;
        const gy = pad;

        drawSingleGraph(ctx, gx, gy, gw, gh, sim.history, 'v', '#d35400', 'Скорость v(t), м/с');
        gx += gw + 40;
        drawSingleGraph(ctx, gx, gy, gw, gh, sim.history, 'x', '#0066cc', 'Перемещение s(t), м');
        gx += gw + 40;
        drawSingleGraph(ctx, gx, gy, gw, gh, sim.history, 'work', '#dc3545', 'Работа трения Aтр(t), Дж');
    }

    function drawSingleGraph(ctx, x, y, w, h, data, key, color, title) {

        // 1. Заголовок (только название)
        ctx.fillStyle = 'black';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(title, x, y - 5);

        // 2. Рамка (оси)
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);

        // 3. Установка клиппинга (обрезки)
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 1, y + 1, w - 2, h - 2);
        ctx.clip();

        if (data.length > 0) {
            // Расчет лимитов Y
            let maxVal = -Infinity, minVal = Infinity;
            let maxTime = 0;

            data.forEach(d => {
                if (d[key] > maxVal) maxVal = d[key];
                if (d[key] < minVal) minVal = d[key];
                if (d.t > maxTime) maxTime = d.t;
            });

            if (maxVal === minVal) { maxVal += 1; minVal -= 1; }
            if (maxVal < 0.1 && maxVal > -0.1) maxVal = 1;
            if (maxTime < 0.1) maxTime = 5;

            const range = maxVal - minVal;
            const drawMax = maxVal + range * 0.1;
            const drawMin = minVal - range * 0.1;
            const drawRange = drawMax - drawMin;

            // --- 4. Сетка ---
            ctx.strokeStyle = '#eee';
            ctx.lineWidth = 1;
            ctx.fillStyle = '#999';

            // Горизонтальные линии (5 линий: 0, 25%, 50%, 75%, 100%)
            for(let i=0; i<=4; i++) {
                const py = y + h - (h * i / 4);
                ctx.beginPath();
                ctx.moveTo(x, py);
                ctx.lineTo(x + w, py);
                ctx.stroke();
            }

            // Вертикальные линии (3 промежуточных)
            for(let i=1; i<=3; i++) {
                const px = x + (w * i / 4);
                ctx.beginPath();
                ctx.moveTo(px, y);
                ctx.lineTo(px, y + h);
                ctx.stroke();
            }

            // --- 5. Сам график ---
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();

            const step = Math.ceil(data.length / w);

            for (let i = 0; i < data.length; i += (step < 1 ? 1 : step)) {
                const pt = data[i];
                const px = x + (pt.t / maxTime) * w;
                const py = y + h - ((pt[key] - drawMin) / drawRange) * h;

                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        }

        ctx.restore(); // Снимаем клиппинг

        // --- 6. Подписи осей (вне области клиппинга) ---

        if (data.length > 0) {
            // Повторный расчет Draw Limits для корректного вывода значений
            let maxVal = -Infinity, minVal = Infinity;
            let maxTime = 0;
            data.forEach(d => {
                if (d[key] > maxVal) maxVal = d[key];
                if (d[key] < minVal) minVal = d[key];
                if (d.t > maxTime) maxTime = d.t;
            });
            if (maxVal === minVal) { maxVal += 1; minVal -= 1; }
            if (maxTime < 0.1) maxTime = 5;

            const range = maxVal - minVal;
            const drawMax = maxVal + range * 0.1;
            const drawMin = minVal - range * 0.1;
            const drawRange = drawMax - drawMin;

            ctx.fillStyle = '#333';
            ctx.font = '10px Arial';
            const precision = (key === 'work' || key === 'x') ? 1 : 1;

            // Подписи Y-оси (слева)
            ctx.textAlign = 'right';
            for(let i=0; i<=4; i++) {
                const val = drawMin + (drawRange * i / 4);
                const py = y + h - ((val - drawMin) / drawRange) * h;

                ctx.fillText(val.toFixed(precision), x - 5, py + 3); // -5px offset to the left
            }

            // Подписи X-оси (Время, внизу)
            ctx.textAlign = 'center';
            for(let i=1; i<=3; i++) {
                const tVal = maxTime * i / 4;
                const px = x + (tVal / maxTime) * w;
                ctx.fillText(tVal.toFixed(1), px, y + h + 12);
            }

            // Метка для оси x (t, с)
            ctx.textAlign = 'right';
            ctx.fillText('t, с', x + w - 5, y + h + 12);
        }
    }

    // --- АНИМАЦИОННЫЙ ЦИКЛ ---
    function loop(timestamp) {
        if (!sim.lastFrameTime) sim.lastFrameTime = timestamp;
        const dt = (timestamp - sim.lastFrameTime) / 1000;
        sim.lastFrameTime = timestamp;

        if (sim.running) {
            // Ограничиваем dt, чтобы не было гигантского шага после долгой паузы
            updatePhysics(Math.min(dt, 0.05));
        }
        drawScene();
        requestAnimationFrame(loop);
    }

    btnStart.addEventListener('click', () => {
        if (sim.finished) resetSim();
        sim.running = !sim.running;
        btnStart.textContent = sim.running ? "Пауза" : "Запуск";
        sim.lastFrameTime = performance.now();
    });

    btnReset.addEventListener('click', resetSim);

    // Запуск первого кадра и цикла
    drawScene();
    requestAnimationFrame(loop);
});
