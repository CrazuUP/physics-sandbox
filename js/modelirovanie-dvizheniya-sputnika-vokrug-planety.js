(() => {
    'use strict';
    
    // ========== КОНСТАНТЫ ==========
    const G = 6.67430e-11; // м³/(кг·с²)
    const EARTH_MASS = 5.972e24; // кг
    const EARTH_RADIUS = 6.371e6; // м
    const MOON_MASS = 7.342e22; // кг
    const TWO_PI = Math.PI * 2;
    
    // Параметры симуляции
    const DT = 0.5; // шаг интегратора (с)
    const MAX_TRACE = 5000; // точек следа
    const GRAPH_INTERVAL = 1.0; // интервал сэмплирования графиков (с)
    
    // ========== DOM ЭЛЕМЕНТЫ ==========
    const canvas = document.getElementById('orbit-canvas');
    const graphCanvas = document.getElementById('orbit-graph-canvas');
    const graphContainer = document.getElementById('orbit-graphs-container');
    
    if (!canvas) {
        console.error('orbit-canvas not found');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    const graphCtx = graphCanvas ? graphCanvas.getContext('2d') : null;
    
    // Предупреждение если графики недоступны
    if (!graphCanvas || !graphContainer) {
        console.warn('График энергии недоступен - элементы не найдены в HTML');
    }
    
    // Inputs
    const inputs = {
        planetMass: document.getElementById('orbit-planet-mass'),
        radius: document.getElementById('orbit-radius'),
        inclination: document.getElementById('orbit-inclination'),
        drag: document.getElementById('orbit-drag'),
        satelliteMass: document.getElementById('orbit-satellite-mass'),
        initialSpeed: document.getElementById('orbit-initial-speed'),
        flightAngle: document.getElementById('orbit-flight-angle'),
        thrust: document.getElementById('orbit-thrust')
    };
    
    const outputs = {
        planetMass: document.getElementById('orbit-planet-mass-value'),
        radius: document.getElementById('orbit-radius-value'),
        inclination: document.getElementById('orbit-inclination-value'),
        drag: document.getElementById('orbit-drag-value'),
        satelliteMass: document.getElementById('orbit-satellite-mass-value'),
        initialSpeed: document.getElementById('orbit-initial-speed-value'),
        flightAngle: document.getElementById('orbit-flight-angle-value'),
        thrust: document.getElementById('orbit-thrust-value')
    };
    
    const checkboxes = {
        trace: document.getElementById('orbit-show-trace'),
        apsis: document.getElementById('orbit-show-apsis'),
        energy: document.getElementById('orbit-show-energy')
    };
    
    const buttons = {
        start: document.getElementById('orbit-start'),
        reset: document.getElementById('orbit-reset')
    };
    
    // ========== СОСТОЯНИЕ ==========
    const state = {
        running: false,
        paused: false,
        
        // Параметры системы
        M: EARTH_MASS, // масса планеты (кг)
        m: 0.05 * MOON_MASS, // масса спутника (кг)
        R_planet: EARTH_RADIUS, // радиус планеты (м)
        drag: 0, // сопротивление
        
        // Позиция и скорость
        x: 0, y: 0,
        vx: 0, vy: 0,
        t: 0,
        
        // Орбитальные элементы (кэш для стабильности)
        orbitalElements: {
            e: 0, // эксцентриситет
            a: 0, // большая полуось
            rp: 0, // радиус перигея
            ra: 0, // радиус апогея
            periAngle: 0, // угол перигея
            T: 0, // период
            isCircular: false,
            isBound: true
        },
        
        // Данные для визуализации
        trace: [],
        graphData: [],
        lastGraphTime: 0
    };
    
    // ========== ИНИЦИАЛИЗАЦИЯ UI ==========
    function initUI() {
        // Обновление output при изменении input
        Object.keys(inputs).forEach(key => {
            const inp = inputs[key];
            const out = outputs[key];
            if (!inp || !out) return;
            
            const update = () => {
                const val = parseFloat(inp.value);
                out.textContent = val >= 10 ? val.toFixed(1) : val.toFixed(2);
            };
            
            inp.addEventListener('input', update);
            update();
        });
        
        // Кнопка Старт/Пауза
        buttons.start.addEventListener('click', () => {
            if (!state.running) {
                readParams();
                resetSimulation();
                state.running = true;
                buttons.start.textContent = 'Пауза';
                requestAnimationFrame(mainLoop);
            } else {
                state.running = false;
                buttons.start.textContent = 'Запуск симуляции';
            }
        });
        
        // Кнопка Сброс
        buttons.reset.addEventListener('click', () => {
            state.running = false;
            buttons.start.textContent = 'Запуск симуляции';
            readParams();
            resetSimulation();
            render();
        });
        
        // Изменение параметров при остановке
        Object.values(inputs).forEach(inp => {
            if (!inp) return;
            inp.addEventListener('input', () => {
                if (!state.running) {
                    readParams();
                    resetSimulation();
                    render();
                }
            });
        });
        
        // Чекбоксы
        if (checkboxes.trace) {
            checkboxes.trace.addEventListener('change', () => {
                render();
            });
        }
        if (checkboxes.apsis) {
            checkboxes.apsis.addEventListener('change', () => {
                render();
            });
        }
        if (checkboxes.energy) {
            checkboxes.energy.addEventListener('change', () => {
                if (graphContainer) {
                    graphContainer.style.display = checkboxes.energy.checked ? 'block' : 'none';
                }
                renderGraphs();
                render();
            });
        }
        
        window.addEventListener('resize', () => {
            fitCanvas(canvas);
            if (graphCanvas) fitCanvas(graphCanvas);
            render();
            renderGraphs();
        });
        
        fitCanvas(canvas);
        if (graphCanvas) fitCanvas(graphCanvas);
    }
    
    // ========== ЧТЕНИЕ ПАРАМЕТРОВ ==========
    function readParams() {
        state.M = parseFloat(inputs.planetMass.value) * EARTH_MASS;
        state.m = parseFloat(inputs.satelliteMass.value) * MOON_MASS;
        state.R_planet = EARTH_RADIUS;
        state.drag = parseFloat(inputs.drag.value);
        
        // Начальные условия
        const h0 = parseFloat(inputs.radius.value) * 1e6; // тыс. км -> м
        const v0 = parseFloat(inputs.initialSpeed.value) * 1000; // км/с -> м/с
        const angleRad = parseFloat(inputs.flightAngle.value) * Math.PI / 180;
        const inclinationRad = parseFloat(inputs.inclination.value) * Math.PI / 180;
        const thrustVal = parseFloat(inputs.thrust.value);
        
        // Начальная позиция (спутник справа от планеты)
        const r0 = state.R_planet + h0;
        state.x = r0;
        state.y = 0;
        
        // Начальная скорость (по касательной, с углом)
        state.vx = -v0 * Math.sin(angleRad);
        state.vy = v0 * Math.cos(angleRad);
        
        // Наклон орбиты
        if (inclinationRad !== 0) {
            state.vy *= Math.cos(inclinationRad);
        }
        
        // Импульс коррекции
        if (thrustVal > 0) {
            const vMag = Math.sqrt(state.vx**2 + state.vy**2);
            if (vMag > 0) {
                state.vx += (state.vx / vMag) * thrustVal;
                state.vy += (state.vy / vMag) * thrustVal;
            }
        }
    }
    
    // ========== СБРОС СИМУЛЯЦИИ ==========
    function resetSimulation() {
        state.t = 0;
        state.trace = [];
        state.graphData = [];
        state.lastGraphTime = 0;
        
        // Записываем начальную точку
        state.trace.push({ x: state.x, y: state.y });
        calculateOrbitalElements();
        recordGraph();
    }
    
    // ========== РАСЧЕТ ОРБИТАЛЬНЫХ ЭЛЕМЕНТОВ ==========
    function calculateOrbitalElements() {
        const mu = G * state.M;
        const x = state.x;
        const y = state.y;
        const vx = state.vx;
        const vy = state.vy;
        
        const r = Math.sqrt(x*x + y*y);
        const v2 = vx*vx + vy*vy;
        
        // Удельная энергия
        const eps = v2/2 - mu/r;
        
        // Момент импульса (z-компонента)
        const h = x*vy - y*vx;
        
        // Вектор эксцентриситета (Лаплас-Рунге-Ленц / mu)
        const rv_dot = x*vx + y*vy;
        const ex = ((v2 - mu/r)*x - rv_dot*vx) / mu;
        const ey = ((v2 - mu/r)*y - rv_dot*vy) / mu;
        const e = Math.sqrt(ex*ex + ey*ey);
        
        // Параметр орбиты p = h^2/mu
        const p = (h*h) / mu;
        
        let rp, ra, a, T;
        const isBound = (eps < 0);
        const isCircular = (e < 0.02);
        
        if (isCircular) {
            // Круговая
            rp = ra = r;
            a = r;
            T = TWO_PI * Math.sqrt(a*a*a / mu);
        } else if (isBound) {
            // Эллипс
            a = -mu / (2 * eps);
            rp = Math.max(0, a * (1 - e)); // Защита от отрицательных значений
            ra = a * (1 + e);
            T = TWO_PI * Math.sqrt(a*a*a / mu);
        } else {
            // Гипербола/парабола
            rp = Math.max(0, p / (1 + e)); // Защита от отрицательных значений
            ra = Infinity;
            a = NaN;
            T = Infinity;
        }
        
        // Дополнительная проверка: rp должен быть положительным
        if (rp <= 0 || !isFinite(rp)) {
            rp = r; // Используем текущее расстояние как fallback
        }
        
        const periAngle = Math.atan2(ey, ex);
        
        state.orbitalElements = {
            e, a, rp, ra, periAngle, T,
            isCircular, isBound
        };
    }
    
    // ========== ФИЗИЧЕСКИЙ ШАГ (Velocity Verlet) ==========
    function stepPhysics(dt) {
        const mu = G * state.M;
        
        // Текущая сила/ускорение
        const r = Math.sqrt(state.x**2 + state.y**2);
        if (r < state.R_planet * 0.9) {
            // Столкновение с планетой - останавливаем
            state.running = false;
            return;
        }
        
        let ax = -mu * state.x / (r*r*r);
        let ay = -mu * state.y / (r*r*r);
        
        // Сопротивление
        if (state.drag > 0) {
            const v = Math.sqrt(state.vx**2 + state.vy**2);
            if (v > 0) {
                const dragAcc = state.drag * v;
                ax -= (state.vx / v) * dragAcc;
                ay -= (state.vy / v) * dragAcc;
            }
        }
        
        // Обновляем позицию
        state.x += state.vx * dt + 0.5 * ax * dt * dt;
        state.y += state.vy * dt + 0.5 * ay * dt * dt;
        
        // Новая сила/ускорение
        const r_new = Math.sqrt(state.x**2 + state.y**2);
        let ax_new = -mu * state.x / (r_new*r_new*r_new);
        let ay_new = -mu * state.y / (r_new*r_new*r_new);
        
        if (state.drag > 0) {
            const v_est = Math.sqrt((state.vx + ax*dt)**2 + (state.vy + ay*dt)**2);
            if (v_est > 0) {
                const dragAcc = state.drag * v_est;
                const vx_est = state.vx + ax*dt;
                const vy_est = state.vy + ay*dt;
                ax_new -= (vx_est / v_est) * dragAcc;
                ay_new -= (vy_est / v_est) * dragAcc;
            }
        }
        
        // Обновляем скорость
        state.vx += 0.5 * (ax + ax_new) * dt;
        state.vy += 0.5 * (ay + ay_new) * dt;
        
        state.t += dt;
        
        // След (каждые 2 шага, чтобы не слишком густой)
        if (state.trace.length === 0 || state.t % (dt * 2) < dt) {
            state.trace.push({ x: state.x, y: state.y });
            if (state.trace.length > MAX_TRACE) state.trace.shift();
        }
        
        // График
        if (state.t - state.lastGraphTime >= GRAPH_INTERVAL) {
            recordGraph();
            state.lastGraphTime = state.t;
        }
        
        // Пересчитываем орбитальные элементы (каждые 10 шагов для стабильности)
        if (Math.floor(state.t / dt) % 10 === 0) {
            calculateOrbitalElements();
        }
    }
    
    // ========== ЗАПИСЬ ГРАФИКОВ ==========
    function recordGraph() {
        const r = Math.sqrt(state.x**2 + state.y**2);
        const v2 = state.vx**2 + state.vy**2;
        
        const K = 0.5 * state.m * v2;
        const U = -G * state.M * state.m / r;
        const E = K + U;
        
        const L = state.m * (state.x * state.vy - state.y * state.vx);
        
        state.graphData.push({ t: state.t, E, L });
        if (state.graphData.length > 600) state.graphData.shift();
    }
    
    // ========== ОТРИСОВКА ГРАФИКОВ ==========
    function renderGraphs() {
        console.log('renderGraphs вызвана');
        
        // Проверяем наличие всех необходимых элементов
        if (!graphCtx || !graphCanvas) {
            console.log('renderGraphs: нет graphCtx или graphCanvas');
            return;
        }
        
        // Проверяем включен ли чекбокс
        if (!checkboxes.energy) {
            console.log('renderGraphs: нет чекбокса energy');
            return;
        }
        
        if (!checkboxes.energy.checked) {
            console.log('renderGraphs: чекбокс выключен');
            return;
        }
        
        console.log('renderGraphs: рисуем график, данных:', state.graphData.length);
        
        // Проверяем наличие данных
        if (state.graphData.length < 2) {
            // Рисуем пустой график с сообщением
            const W = graphCanvas.width / (window.devicePixelRatio || 1);
            const H = graphCanvas.height / (window.devicePixelRatio || 1);
            graphCtx.clearRect(0, 0, W, H);
            
            graphCtx.fillStyle = '#e6f2ff';
            graphCtx.fillRect(0, 0, W, H);
            
            graphCtx.fillStyle = '#003366';
            graphCtx.font = 'bold 16px sans-serif';
            graphCtx.textAlign = 'center';
            graphCtx.fillText('Накопление данных...', W/2, H/2);
            return;
        }
        
        const W = graphCanvas.width / (window.devicePixelRatio || 1);
        const H = graphCanvas.height / (window.devicePixelRatio || 1);
        graphCtx.clearRect(0, 0, W, H);
        
        const pad = 50;
        const gw = W - 2*pad;
        const gh = H - 2*pad;
        
        // Диапазоны
        let minE = Infinity, maxE = -Infinity;
        let minL = Infinity, maxL = -Infinity;
        state.graphData.forEach(d => {
            if (d.E < minE) minE = d.E;
            if (d.E > maxE) maxE = d.E;
            if (Math.abs(d.L) < minL) minL = Math.abs(d.L);
            if (Math.abs(d.L) > maxL) maxL = Math.abs(d.L);
        });
        
        const rangeE = (maxE - minE) || 1;
        const rangeL = (maxL - minL) || 1;
        
        // Оси
        graphCtx.fillStyle = '#f5f5f5';
        graphCtx.fillRect(pad, pad, gw, gh);
        graphCtx.strokeStyle = '#999';
        graphCtx.strokeRect(pad, pad, gw, gh);
        
        const tStart = state.graphData[0].t;
        const tEnd = state.graphData[state.graphData.length-1].t;
        const tRange = tEnd - tStart || 1;
        
        // Energy (синий)
        graphCtx.beginPath();
        graphCtx.strokeStyle = '#007bff';
        graphCtx.lineWidth = 2;
        state.graphData.forEach((d, i) => {
            const px = pad + ((d.t - tStart) / tRange) * gw;
            const py = pad + gh - ((d.E - minE) / rangeE) * gh;
            if (i===0) graphCtx.moveTo(px, py);
            else graphCtx.lineTo(px, py);
        });
        graphCtx.stroke();
        
        // Angular Momentum (оранжевый)
        graphCtx.beginPath();
        graphCtx.strokeStyle = '#ff8800';
        graphCtx.lineWidth = 2;
        state.graphData.forEach((d, i) => {
            const px = pad + ((d.t - tStart) / tRange) * gw;
            const py = pad + gh - ((Math.abs(d.L) - minL) / rangeL) * gh;
            if (i===0) graphCtx.moveTo(px, py);
            else graphCtx.lineTo(px, py);
        });
        graphCtx.stroke();
        
        // Легенда
        graphCtx.font = '11px monospace';
        graphCtx.fillStyle = '#007bff';
        graphCtx.fillText(`E: ${state.graphData[state.graphData.length-1].E.toExponential(2)} J`, pad+5, pad+15);
        graphCtx.fillStyle = '#ff8800';
        graphCtx.fillText(`L: ${Math.abs(state.graphData[state.graphData.length-1].L).toExponential(2)}`, pad+5, pad+30);
    }
    
    // ========== ГЛАВНЫЙ РЕНДЕРИНГ ==========
    function render() {
        const W = canvas.width / (window.devicePixelRatio || 1);
        const H = canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, W, H);
        
        // Пересчитываем орбиту для актуальной инфо
        calculateOrbitalElements();
        const oe = state.orbitalElements;
        
        // Масштаб (показываем всю орбиту + запас)
        let viewR = oe.ra < Infinity ? oe.ra * 1.2 : Math.max(oe.rp * 3, Math.sqrt(state.x**2 + state.y**2) * 1.5);
        viewR = Math.max(viewR, state.R_planet * 3);
        
        const scale = Math.min(W, H) / (2 * viewR);
        const cx = W/2, cy = H/2;
        
        // Радиус круглой области визуализации
        const viewportRadius = Math.min(W, H) / 2 - 10;
        
        // === ФОН ===
        ctx.fillStyle = '#000011';
        ctx.fillRect(0, 0, W, H);
        
        // Создаем круглую область отсечения
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, viewportRadius, 0, TWO_PI);
        ctx.clip();
        
        // Фон внутри круга (градиент от центра)
        const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, viewportRadius);
        bgGrad.addColorStop(0, '#000022');
        bgGrad.addColorStop(1, '#000011');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);
        
        // Звезды (внутри круга)
        ctx.fillStyle = '#fff';
        for (let i=0; i<100; i++) {
            const angle = (i * 2.399) % TWO_PI;
            const dist = ((i * 137.509) % 100) / 100 * viewportRadius * 0.95;
            const sx = cx + Math.cos(angle) * dist;
            const sy = cy + Math.sin(angle) * dist;
            const size = 1 + ((i * 7) % 3) * 0.3;
            ctx.fillRect(sx, sy, size, size);
        }
        
        // === СЛЕД ===
        if (checkboxes.trace && checkboxes.trace.checked && state.trace.length > 1) {
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#00aaff';
            ctx.beginPath();
            state.trace.forEach((p, i) => {
                const sx = cx + p.x * scale;
                const sy = cy - p.y * scale;
                if (i === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
            });
            ctx.stroke();
        }
        
        // === ПЛАНЕТА ===
        const rp_screen = state.R_planet * scale;
        
        // Базовый градиент (океаны)
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rp_screen);
        grad.addColorStop(0, '#4a90e2');
        grad.addColorStop(0.7, '#2c7ab0');
        grad.addColorStop(1, '#1a3d6b');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, rp_screen, 0, TWO_PI);
        ctx.fill();
        
        // Континенты (упрощенные формы)
        ctx.fillStyle = 'rgba(100, 150, 80, 0.6)';
        const drawContinent = (angleOffset, distFromCenter, size) => {
            const angle = (state.t * 0.01 + angleOffset) % TWO_PI; // Медленное вращение
            const x = cx + Math.cos(angle) * distFromCenter * rp_screen;
            const y = cy + Math.sin(angle) * distFromCenter * rp_screen;
            
            ctx.beginPath();
            ctx.arc(x, y, size * rp_screen, 0, TWO_PI);
            ctx.fill();
        };
        
        // Несколько континентов
        drawContinent(0.5, 0.4, 0.15);
        drawContinent(1.8, 0.5, 0.12);
        drawContinent(3.5, 0.3, 0.18);
        drawContinent(4.8, 0.6, 0.10);
        
        // Полярные шапки
        ctx.fillStyle = 'rgba(240, 250, 255, 0.7)';
        ctx.beginPath();
        ctx.arc(cx, cy - rp_screen * 0.7, rp_screen * 0.15, 0, TWO_PI);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy + rp_screen * 0.7, rp_screen * 0.15, 0, TWO_PI);
        ctx.fill();
        
        // Облака
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        for (let i = 0; i < 8; i++) {
            const cloudAngle = (state.t * 0.02 + i * 0.8) % TWO_PI;
            const cloudDist = 0.5 + (i % 3) * 0.15;
            const cloudX = cx + Math.cos(cloudAngle) * cloudDist * rp_screen;
            const cloudY = cy + Math.sin(cloudAngle) * cloudDist * rp_screen;
            ctx.beginPath();
            ctx.arc(cloudX, cloudY, rp_screen * 0.08, 0, TWO_PI);
            ctx.fill();
        }
        
        // Терминатор (тень для объема)
        const shadowGrad = ctx.createRadialGradient(cx - rp_screen * 0.3, cy - rp_screen * 0.3, 0, cx, cy, rp_screen);
        shadowGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        shadowGrad.addColorStop(0.6, 'rgba(0, 0, 0, 0.2)');
        shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
        ctx.fillStyle = shadowGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, rp_screen, 0, TWO_PI);
        ctx.fill();
        
        // Атмосфера
        if (state.drag > 0) {
            ctx.strokeStyle = 'rgba(135, 206, 250, 0.5)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cx, cy, rp_screen * 1.08, 0, TWO_PI);
            ctx.stroke();
        }
        
        // === АПОГЕЙ И ПЕРИГЕЙ ===
        if (checkboxes.apsis && checkboxes.apsis.checked && !oe.isCircular) {
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 1;
            
            // Перигей (показываем только если он выше поверхности планеты)
            if (oe.rp >= state.R_planet) {
                const periX = cx + Math.cos(oe.periAngle) * oe.rp * scale;
                const periY = cy - Math.sin(oe.periAngle) * oe.rp * scale;
                ctx.strokeStyle = '#00ff00';
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(periX, periY);
                ctx.stroke();
                
                ctx.fillStyle = '#00ff00';
                ctx.beginPath();
                ctx.arc(periX, periY, 5, 0, TWO_PI);
                ctx.fill();
                ctx.font = 'bold 13px sans-serif';
                ctx.fillText('Перигей', periX + 10, periY - 5);
            }
            
            // Апогей (если замкнута)
            if (oe.isBound && oe.ra < Infinity) {
                const apoX = cx - Math.cos(oe.periAngle) * oe.ra * scale;
                const apoY = cy + Math.sin(oe.periAngle) * oe.ra * scale;
                ctx.strokeStyle = '#ff4444';
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(apoX, apoY);
                ctx.stroke();
                
                ctx.fillStyle = '#ff4444';
                ctx.beginPath();
                ctx.arc(apoX, apoY, 5, 0, TWO_PI);
                ctx.fill();
                ctx.fillText('Апогей', apoX + 10, apoY - 5);
            }
            
            ctx.setLineDash([]);
        }
        
        // === СПУТНИК С СОЛНЕЧНЫМИ ПАНЕЛЯМИ ===
        const satX = cx + state.x * scale;
        const satY = cy - state.y * scale;
        
        // Угол поворота спутника (по касательной к орбите)
        const satAngle = Math.atan2(state.vy, state.vx);
        
        ctx.save();
        ctx.translate(satX, satY);
        ctx.rotate(satAngle);
        
        // Солнечные панели
        ctx.fillStyle = '#1a3d6b';
        ctx.fillRect(-15, -3, 8, 6); // Левая панель
        ctx.fillRect(7, -3, 8, 6);   // Правая панель
        
        // Сегменты панелей
        ctx.strokeStyle = '#4a90e2';
        ctx.lineWidth = 0.5;
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(-15 + i * 2.5, -3);
            ctx.lineTo(-15 + i * 2.5, 3);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(7 + i * 2.5, -3);
            ctx.lineTo(7 + i * 2.5, 3);
            ctx.stroke();
        }
        
        // Корпус спутника
        ctx.fillStyle = '#cccccc';
        ctx.fillRect(-4, -4, 8, 8);
        
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1;
        ctx.strokeRect(-4, -4, 8, 8);
        
        // Антенна
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -4);
        ctx.lineTo(0, -8);
        ctx.stroke();
        
        ctx.fillStyle = '#ffaa00';
        ctx.beginPath();
        ctx.arc(0, -8, 1.5, 0, TWO_PI);
        ctx.fill();
        
        // Свечение
        ctx.restore();
        const glow = ctx.createRadialGradient(satX, satY, 0, satX, satY, 15);
        glow.addColorStop(0, 'rgba(255, 215, 0, 0.4)');
        glow.addColorStop(1, 'rgba(255, 215, 0, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(satX, satY, 15, 0, TWO_PI);
        ctx.fill();
        
        // Восстанавливаем контекст (убираем клиппинг)
        ctx.restore();
        
        // Рисуем круглую рамку поверх всего
        ctx.strokeStyle = '#2a4a7a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, viewportRadius, 0, TWO_PI);
        ctx.stroke();
        
        // Внешнее свечение рамки
        ctx.strokeStyle = 'rgba(74, 144, 226, 0.3)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, viewportRadius + 3, 0, TWO_PI);
        ctx.stroke();
        
        // === КООРДИНАТНАЯ СЕТКА (если включена) ===
        if (checkboxes.trace && checkboxes.trace.checked) {
            ctx.strokeStyle = 'rgba(100, 150, 200, 0.15)';
            ctx.lineWidth = 0.5;
            
            // Концентрические окружности
            for (let i = 1; i <= 5; i++) {
                const gridR = viewportRadius * (i / 5);
                ctx.beginPath();
                ctx.arc(cx, cy, gridR, 0, TWO_PI);
                ctx.stroke();
            }
            
            // Радиальные линии
            for (let i = 0; i < 12; i++) {
                const angle = (i * TWO_PI / 12);
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + Math.cos(angle) * viewportRadius, cy + Math.sin(angle) * viewportRadius);
                ctx.stroke();
            }
        }
        
        // === ПРАВАЯ ПАНЕЛЬ НАБЛЮДЕНИЯ ===
        const panelX = W - 270;
        const panelY = 10;
        const panelW = 250;
        const panelH = Math.min(H - 20, 400);
        
        // Фон панели (темно-синий, как на скриншоте)
        ctx.fillStyle = 'rgba(5, 15, 35, 0.95)';
        ctx.fillRect(panelX, panelY, panelW, panelH);
        ctx.strokeStyle = '#1a3a5a';
        ctx.lineWidth = 1;
        ctx.strokeRect(panelX, panelY, panelW, panelH);
        
        // Заголовок панели
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('ПАНЕЛЬ НАБЛЮДЕНИЯ', panelX + panelW/2, panelY + 20);
        
        // Разделитель
        ctx.strokeStyle = '#1a3a5a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(panelX + 10, panelY + 30);
        ctx.lineTo(panelX + panelW - 10, panelY + 30);
        ctx.stroke();
        
        const r_curr = Math.sqrt(state.x**2 + state.y**2);
        
        let py = panelY + 50;
        
        // Функция для рисования блока информации (как на скриншоте)
        const drawInfoBlock = (label, value, color = '#ffffff') => {
            ctx.textAlign = 'left';
            
            // Заголовок (серый, маленький)
            ctx.font = '11px sans-serif';
            ctx.fillStyle = '#7a8a9a';
            ctx.fillText(label, panelX + 15, py);
            py += 30; // Увеличил отступ с 22 до 30
            
            // Значение (КРУПНОЕ, цветное)
            ctx.font = 'bold 42px monospace';
            ctx.fillStyle = color;
            ctx.fillText(value, panelX + 15, py);
            py += 50;
        };
        
        // Апогей
        if (oe.isBound && oe.ra < Infinity) {
            const apoVal = Math.round((oe.ra - state.R_planet)/1000);
            drawInfoBlock('АПОГЕЙ', apoVal.toString(), '#ff3344');
        } else if (!oe.isCircular) {
            drawInfoBlock('АПОГЕЙ', '∞', '#ff8800');
        }
        
        // Перигей (показываем только если он выше поверхности планеты)
        if (!oe.isCircular && oe.rp > 0 && oe.rp >= state.R_planet) {
            const heightKm = (oe.rp - state.R_planet) / 1000;
            const periVal = Math.round(heightKm);
            drawInfoBlock('ПЕРИГЕЙ', periVal.toString(), '#00ff44');
        } else if (!oe.isCircular && oe.rp > 0 && oe.rp < state.R_planet) {
            // Перигей внутри планеты - показываем предупреждение
            drawInfoBlock('ПЕРИГЕЙ', 'СТОЛКНОВЕНИЕ', '#ff0000');
        }
        
        // Период
        if (oe.isBound && oe.T < Infinity) {
            const hours = (oe.T / 3600).toFixed(1);
            drawInfoBlock('ПЕРИОД ОБРАЩЕНИЯ', hours, '#00aaff');
        }
        
        // Изменение энергии
        if (state.graphData.length > 1) {
            const E0 = state.graphData[0].E;
            const E_curr = state.graphData[state.graphData.length - 1].E;
            const dE = Math.abs(E_curr - E0) / Math.abs(E0) * 1e6; // В миллионных долях
            drawInfoBlock('ИЗМЕНЕНИЕ ЭНЕРГИИ', dE.toFixed(3), '#ffaa00');
        }
        
        // Трассировка
        py += 5;
        ctx.fillStyle = '#7a8a9a';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('ТРАССИРОВКА', panelX + 15, py);
        py += 20;
        
        // Квадратная галочка для сетки
        ctx.strokeStyle = '#3a5a7a';
        ctx.lineWidth = 1;
        ctx.strokeRect(panelX + 18, py - 12, 14, 14);
        
        if (checkboxes.trace && checkboxes.trace.checked) {
            ctx.strokeStyle = '#00ff44';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(panelX + 20, py - 5);
            ctx.lineTo(panelX + 23, py - 2);
            ctx.lineTo(panelX + 30, py - 10);
            ctx.stroke();
        }
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '13px sans-serif';
        ctx.fillText('СЕТКА', panelX + 40, py);
    }
    
    // ========== ГЛАВНЫЙ ЦИКЛ ==========
    let lastTime = null;
    function mainLoop(time) {
        if (!state.running) {
            lastTime = null;
            return;
        }
        
        if (lastTime === null) lastTime = time;
        const elapsed = Math.min((time - lastTime) / 1000, 0.1); // ограничиваем большие скачки
        lastTime = time;
        
        // Несколько подшагов
        let remaining = elapsed;
        while (remaining > 0) {
            const dt = Math.min(remaining, DT);
            stepPhysics(dt);
            remaining -= dt;
        }
        
        render();
        renderGraphs();
        requestAnimationFrame(mainLoop);
    }
    
    // ========== RESIZE CANVAS ==========
    function fitCanvas(cnv) {
        const dpr = window.devicePixelRatio || 1;
        const rect = cnv.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const h = Math.floor(rect.height);
        
        if (cnv.width !== w * dpr || cnv.height !== h * dpr) {
            cnv.width = w * dpr;
            cnv.height = h * dpr;
            cnv.style.width = w + 'px';
            cnv.style.height = h + 'px';
            const c = cnv.getContext('2d');
            c.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    }
    
    // ========== СТАРТ ==========
    initUI();
    readParams();
    resetSimulation();
    
    // Устанавливаем видимость графика при загрузке
    if (graphContainer && checkboxes.energy) {
        const shouldShow = checkboxes.energy.checked;
        graphContainer.style.display = shouldShow ? 'block' : 'none';
        console.log('График энергии при загрузке:', shouldShow ? 'ВКЛЮЧЕН' : 'выключен');
        console.log('graphCanvas:', graphCanvas ? 'найден' : 'НЕ НАЙДЕН');
        console.log('graphCtx:', graphCtx ? 'найден' : 'НЕ НАЙДЕН');
    }
    
    render();
    
    // Принудительно вызываем renderGraphs
    setTimeout(() => {
        renderGraphs();
    }, 100);
    
    // Авто-старт через 500мс
    setTimeout(() => {
        if (!state.running && buttons.start) {
            state.running = true;
            buttons.start.textContent = 'Пауза';
            requestAnimationFrame(mainLoop);
        }
    }, 500);
    
})();
