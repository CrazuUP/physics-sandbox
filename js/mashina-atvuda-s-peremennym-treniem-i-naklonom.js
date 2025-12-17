(() => {
    // Constants
    const G = 9.81;
    const DT = 1 / 60; // Physics step
    const PI = Math.PI;
    const BASE_DIST = 1.2; // Начальное расстояние грузов от блока (м)
    const MIN_DIST_FROM_PULLEY = 0.15; // Минимальное расстояние от блока (м)

    // Canvas & Context
    const canvas = document.getElementById('atwood-canvas');
    if (!canvas) {
        console.error('Canvas element not found');
        return;
    }
    const ctx = canvas.getContext('2d');

    // UI Elements
    const inputs = {
        massA: document.getElementById('atwood-mass-1'),
        massB: document.getElementById('atwood-mass-2'),
        lengthA: document.getElementById('atwood-length-a'),
        lengthB: document.getElementById('atwood-length-b'),
        angleA: document.getElementById('atwood-angle-a'),
        angleB: document.getElementById('atwood-angle-b'),
        fricA: document.getElementById('atwood-friction-a'),
        fricB: document.getElementById('atwood-friction-b'),
        pulleyM: document.getElementById('atwood-pulley-mass'),
        pulleyR: document.getElementById('atwood-pulley-radius'),
        axleFric: document.getElementById('atwood-axle-friction'),
        elasticity: document.getElementById('atwood-rope-elasticity'),
        lockStatic: document.getElementById('atwood-lock-static'),
        showComponents: document.getElementById('atwood-show-components')
    };

    const outputs = {};
    for (const key in inputs) {
        if (!inputs[key]) continue;
        const id = inputs[key].id;
        outputs[key] = document.getElementById(id + '-value');
    }

    const startBtn = document.getElementById('atwood-start');
    const resetBtn = document.getElementById('atwood-reset');
    let downloadBtn = document.getElementById('atwood-download-csv');
    
    // Создаем кнопку скачивания, если её нет
    if (!downloadBtn) {
        downloadBtn = document.createElement('button');
        downloadBtn.id = 'atwood-download-csv';
        downloadBtn.type = 'button';
        downloadBtn.className = 'action-btn';
        downloadBtn.textContent = 'Скачать CSV';
        if (resetBtn && resetBtn.parentNode) {
            resetBtn.parentNode.appendChild(downloadBtn);
        }
    }

    // State
    const state = {
        running: false,
        time: 0,
        // Physics params
        mA: 6.0, mB: 2.0,
        angA: 30, angB: 10,
        muA: 0.15, muB: 0.12,
        M_p: 1.5, R_p: 0.06,
        muAxle: 0.05,
        elasticity: 0,
        useStatic: false,
        
        // Dynamic variables
        pos: 0, // Position along rope (positive = A moves down slope)
        vel: 0, // Velocity
        acc: 0, // Acceleration
        
        // Limits
        limitPos: 2.5, 
        
        // Simulation status
        isStatic: false,
        
        // Data history for CSV export
        history: [],
        lastHistoryTime: 0,
        historyInterval: 0.1 // записываем каждые 0.1 секунды
    };

    // Initialization
    function init() {
        if (!inputs.massA || !inputs.massB || !startBtn) {
            console.error("Critical UI elements missing.");
            return;
        }

        bindEvents();
        readInputs();
        resetSimulation();
        requestAnimationFrame(loop);
    }

    function bindEvents() {
        for (const key in inputs) {
            if (!inputs[key]) continue;
            inputs[key].addEventListener('input', () => {
                updateOutput(key);
                if (!state.running) {
                    readInputs();
                    render();
                }
            });
        }
        
        if (startBtn) startBtn.addEventListener('click', toggleSimulation);
        if (resetBtn) resetBtn.addEventListener('click', () => {
            state.running = false;
            startBtn.textContent = "Запуск симуляции";
            resetToDefaults();
            resetSimulation();
        });
        
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                exportToCSV();
            });
        }

        window.addEventListener('resize', () => {
            fitCanvas();
            render();
        });
        fitCanvas();
    }

    function updateOutput(key) {
        if (outputs[key]) {
            outputs[key].value = inputs[key].value;
        }
    }

    function readInputs() {
        if (!inputs.massA) return;

        state.mA = parseFloat(inputs.massA.value);
        state.mB = parseFloat(inputs.massB.value);
        state.angA = parseFloat(inputs.angleA.value);
        state.angB = parseFloat(inputs.angleB.value);
        state.muA = parseFloat(inputs.fricA.value);
        state.muB = parseFloat(inputs.fricB.value);
        state.M_p = parseFloat(inputs.pulleyM.value);
        state.R_p = parseFloat(inputs.pulleyR.value) / 100; // cm -> m
        state.muAxle = parseFloat(inputs.axleFric.value);
        state.elasticity = parseFloat(inputs.elasticity.value);
        state.useStatic = inputs.lockStatic ? inputs.lockStatic.checked : false;
        state.showComponents = inputs.showComponents ? inputs.showComponents.checked : true;
        
        const lenA = parseFloat(inputs.lengthA.value);
        const lenB = parseFloat(inputs.lengthB.value);
        state.limitPos = Math.min(lenA, lenB) * 0.9; 
    }

    function resetToDefaults() {
        // Возвращаем значения полей ввода к начальным значениям из HTML
        if (inputs.massA) inputs.massA.value = 6;
        if (inputs.massB) inputs.massB.value = 2;
        if (inputs.lengthA) inputs.lengthA.value = 3;
        if (inputs.lengthB) inputs.lengthB.value = 3;
        if (inputs.angleA) inputs.angleA.value = 30;
        if (inputs.angleB) inputs.angleB.value = 10;
        if (inputs.fricA) inputs.fricA.value = 0.15;
        if (inputs.fricB) inputs.fricB.value = 0.12;
        if (inputs.pulleyM) inputs.pulleyM.value = 1.5;
        if (inputs.pulleyR) inputs.pulleyR.value = 6;
        if (inputs.axleFric) inputs.axleFric.value = 0.05;
        if (inputs.elasticity) inputs.elasticity.value = 0;
        if (inputs.lockStatic) inputs.lockStatic.checked = false;
        if (inputs.showComponents) inputs.showComponents.checked = true;
        
        // Обновляем выводы значений
        for (const key in inputs) {
            if (inputs[key]) {
                updateOutput(key);
            }
        }
    }

    function resetSimulation() {
        readInputs();
        state.time = 0;
        state.pos = 0;
        state.vel = 0;
        state.acc = 0;
        state.isStatic = false;
        state.history = [];
        state.lastHistoryTime = 0;
        render();
    }

    function toggleSimulation() {
        state.running = !state.running;
        startBtn.textContent = state.running ? "Пауза" : "Запуск симуляции";
    }

    function fitCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0) return;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Physics Engine - ПРАВИЛЬНАЯ МОДЕЛЬ
    function step(dt) {
        const a1 = state.angA * PI / 180;
        const a2 = state.angB * PI / 180;

        // Компоненты силы тяжести вдоль склонов
        const Fg1_parallel = state.mA * G * Math.sin(a1);
        const Fg2_parallel = state.mB * G * Math.sin(a2);
        
        // Нормальные силы
        const N1 = state.mA * G * Math.cos(a1);
        const N2 = state.mB * G * Math.cos(a2);

        // Движущая сила (если A идет вниз, B идет вверх)
        // F_drive = сила, тянущая A вниз по склону - сила, тянущая B вниз по склону
        const F_drive = Fg1_parallel - Fg2_parallel;

        // Эффективная масса (с учетом инерции блока)
        // I_pulley = 0.5 * M_p * R^2, поэтому I/R^2 = 0.5 * M_p
        const M_eff = state.mA + state.mB + 0.5 * state.M_p;

        // Проверка на статическое равновесие (только если скорость практически нулевая)
        const isStationary = Math.abs(state.vel) < 0.001;
        
        if (isStationary) {
            // Коэффициенты статического трения
            const muS1 = state.useStatic ? state.muA * 1.3 : state.muA;
            const muS2 = state.useStatic ? state.muB * 1.3 : state.muB;
            
            // Максимальная сила трения покоя
            const F_static_max = muS1 * N1 + muS2 * N2;
            
            // Трение в оси блока (упрощенная модель)
            const F_axle = state.muAxle * (state.mA + state.mB) * G * 0.1;
            
            // Если движущая сила меньше максимальной силы трения, система в покое
            if (Math.abs(F_drive) <= F_static_max + F_axle) {
                state.acc = 0;
                state.vel = 0;
                state.isStatic = true;
                return;
            }
        }
        
        state.isStatic = false;

        // Кинетическое трение (всегда противодействует движению)
        // Направление: если vel > 0 (A вниз), трение действует против движения
        let F_friction_kinetic = 0;
        
        if (Math.abs(state.vel) > 0.001) {
            // Трение на A: противодействует движению A
            // Трение на B: противодействует движению B (которое противоположно движению A)
            // Обе силы трения ПРОТИВОДЕЙСТВУЮТ общему движению системы
            const dir = Math.sign(state.vel);
            F_friction_kinetic = (state.muA * N1 + state.muB * N2) * dir;
        } else {
            // При очень малой скорости используем направление потенциального движения
            F_friction_kinetic = (state.muA * N1 + state.muB * N2) * Math.sign(F_drive);
        }

        // Трение в оси блока (пропорционально нагрузке)
        const F_axle = state.muAxle * (state.mA + state.mB) * G * 0.1 * Math.sign(state.vel || F_drive);

        // Результирующая сила
        const F_net = F_drive - F_friction_kinetic - F_axle;
        
        // Ускорение
        state.acc = F_net / M_eff;
        
        // Интегрирование (метод Эйлера)
        state.vel += state.acc * dt;
        state.pos += state.vel * dt;

        // Ограничения (грузы не могут двигаться дальше определенного расстояния)
        // И не могут подниматься выше блока
        
        // Проверяем, чтобы груз A не поднялся выше блока
        // distA = BASE_DIST + state.pos, должно быть >= MIN_DIST_FROM_PULLEY
        // BASE_DIST + state.pos >= MIN_DIST_FROM_PULLEY
        // state.pos >= MIN_DIST_FROM_PULLEY - BASE_DIST
        const minPos = MIN_DIST_FROM_PULLEY - BASE_DIST;
        
        // Проверяем, чтобы груз B не поднялся выше блока
        // distB = BASE_DIST - state.pos, должно быть >= MIN_DIST_FROM_PULLEY
        // BASE_DIST - state.pos >= MIN_DIST_FROM_PULLEY
        // -state.pos >= MIN_DIST_FROM_PULLEY - BASE_DIST
        // state.pos <= BASE_DIST - MIN_DIST_FROM_PULLEY
        const maxPos = BASE_DIST - MIN_DIST_FROM_PULLEY;
        
        // Дополнительное ограничение по длине плеч
        const hardMinPos = -state.limitPos;
        const hardMaxPos = state.limitPos;
        
        // Применяем все ограничения
        const finalMinPos = Math.max(minPos, hardMinPos);
        const finalMaxPos = Math.min(maxPos, hardMaxPos);
        
        if (state.pos < finalMinPos) {
            state.pos = finalMinPos;
            state.vel = 0;
            state.acc = 0;
        }
        
        if (state.pos > finalMaxPos) {
            state.pos = finalMaxPos;
            state.vel = 0;
            state.acc = 0;
        }

        state.time += dt;
        
        // Записываем данные в историю для экспорта
        if (state.time - state.lastHistoryTime >= state.historyInterval) {
            state.history.push({
                t: state.time,
                pos: state.pos,
                vel: state.vel,
                acc: state.acc,
                isStatic: state.isStatic
            });
            state.lastHistoryTime = state.time;
            
            // Ограничиваем размер истории (последние 10000 точек)
            if (state.history.length > 10000) {
                state.history.shift();
            }
        }
    }

    function loop(ts) {
        if (state.running) {
            step(DT);
        }
        render();
        requestAnimationFrame(loop);
    }

    function render() {
        const W = canvas.width / (window.devicePixelRatio || 1);
        const H = canvas.height / (window.devicePixelRatio || 1);
        
        // Красивый градиентный фон
        const bgGradient = ctx.createLinearGradient(0, 0, 0, H);
        bgGradient.addColorStop(0, '#e8f4f8');
        bgGradient.addColorStop(1, '#ffffff');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, W, H);

        const cx = W / 2;
        const cy = 150; // Опустим блок чуть ниже
        const scale = (W * 0.35) / 3.0; // pixels per meter

        const angA = state.angA * PI / 180;
        const angB = state.angB * PI / 180;
        
        const px = cx;
        const py = cy;
        
        // Draw Ramps (наклонные плоскости) - как ОБЪЕМНЫЕ ПОВЕРХНОСТИ
        const rampALen = 4.5 * scale;
        const rampBLen = 4.5 * scale;
        const rampWidth = 60; // Ширина наклонной плоскости в пикселях
        
        // Плоскость A (слева)
        const rampA_x1 = px - rampALen * Math.cos(angA);
        const rampA_y1 = py + rampALen * Math.sin(angA);
        
        // Рисуем как полигон (с боковой гранью для объема)
        ctx.save();
        
        // Верхняя грань наклонной плоскости A с градиентом
        const gradA = ctx.createLinearGradient(
            px - Math.sin(angA) * rampWidth/2, py + Math.cos(angA) * rampWidth/2,
            px - Math.sin(angA) * rampWidth, py + Math.cos(angA) * rampWidth
        );
        gradA.addColorStop(0, '#d4a017');
        gradA.addColorStop(0.5, '#b8860b');
        gradA.addColorStop(1, '#9b7510');
        
        ctx.fillStyle = gradA;
        ctx.strokeStyle = '#705410';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(rampA_x1, rampA_y1);
        ctx.lineTo(rampA_x1 - Math.sin(angA) * rampWidth, rampA_y1 + Math.cos(angA) * rampWidth);
        ctx.lineTo(px - Math.sin(angA) * rampWidth, py + Math.cos(angA) * rampWidth);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Боковая грань для объема (темнее)
        ctx.fillStyle = '#6b5610';
        ctx.strokeStyle = '#4a3c08';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(rampA_x1, rampA_y1);
        ctx.lineTo(rampA_x1 - Math.sin(angA) * rampWidth, rampA_y1 + Math.cos(angA) * rampWidth);
        ctx.lineTo(rampA_x1 - Math.sin(angA) * rampWidth, rampA_y1 + Math.cos(angA) * rampWidth + 40);
        ctx.lineTo(rampA_x1, rampA_y1 + 40);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Плоскость B (справа)
        const rampB_x1 = px + rampBLen * Math.cos(angB);
        const rampB_y1 = py + rampBLen * Math.sin(angB);
        
        // Верхняя грань наклонной плоскости B с градиентом
        const gradB = ctx.createLinearGradient(
            px + Math.sin(angB) * rampWidth/2, py + Math.cos(angB) * rampWidth/2,
            px + Math.sin(angB) * rampWidth, py + Math.cos(angB) * rampWidth
        );
        gradB.addColorStop(0, '#d4a017');
        gradB.addColorStop(0.5, '#b8860b');
        gradB.addColorStop(1, '#9b7510');
        
        ctx.fillStyle = gradB;
        ctx.strokeStyle = '#705410';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(rampB_x1, rampB_y1);
        ctx.lineTo(rampB_x1 + Math.sin(angB) * rampWidth, rampB_y1 + Math.cos(angB) * rampWidth);
        ctx.lineTo(px + Math.sin(angB) * rampWidth, py + Math.cos(angB) * rampWidth);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Боковая грань (темнее)
        ctx.fillStyle = '#6b5610';
        ctx.strokeStyle = '#4a3c08';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(rampB_x1, rampB_y1);
        ctx.lineTo(rampB_x1 + Math.sin(angB) * rampWidth, rampB_y1 + Math.cos(angB) * rampWidth);
        ctx.lineTo(rampB_x1 + Math.sin(angB) * rampWidth, rampB_y1 + Math.cos(angB) * rampWidth + 40);
        ctx.lineTo(rampB_x1, rampB_y1 + 40);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Текстура/штрихи на наклонных плоскостях (показывают трение)
        ctx.strokeStyle = 'rgba(139, 105, 20, 0.4)';
        ctx.lineWidth = 1.5;
        
        // Штрихи на плоскости A (перпендикулярные направлению движения)
        const numLines = 8;
        for (let i = 1; i < numLines; i++) {
            const t = i / numLines;
            const lx1 = px - t * rampALen * Math.cos(angA);
            const ly1 = py + t * rampALen * Math.sin(angA);
            const lx2 = lx1 - Math.sin(angA) * rampWidth * 0.8;
            const ly2 = ly1 + Math.cos(angA) * rampWidth * 0.8;
            ctx.beginPath();
            ctx.moveTo(lx1, ly1);
            ctx.lineTo(lx2, ly2);
            ctx.stroke();
        }
        
        // Штрихи на плоскости B
        for (let i = 1; i < numLines; i++) {
            const t = i / numLines;
            const lx1 = px + t * rampBLen * Math.cos(angB);
            const ly1 = py + t * rampBLen * Math.sin(angB);
            const lx2 = lx1 + Math.sin(angB) * rampWidth * 0.8;
            const ly2 = ly1 + Math.cos(angB) * rampWidth * 0.8;
            ctx.beginPath();
            ctx.moveTo(lx1, ly1);
            ctx.lineTo(lx2, ly2);
            ctx.stroke();
        }
        
        // Подписи плоскостей с фоном
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        
        // Плоскость A
        const labelAx = px - rampALen * 0.7 * Math.cos(angA) - Math.sin(angA) * rampWidth * 0.5;
        const labelAy = py + rampALen * 0.7 * Math.sin(angA) + Math.cos(angA) * rampWidth * 0.5;
        const textA = `α=${state.angA}° μ=${state.muA}`;
        const metricsA = ctx.measureText(textA);
        
        ctx.fillStyle = 'rgba(52, 152, 219, 0.8)';
        ctx.fillRect(labelAx - metricsA.width/2 - 5, labelAy - 16, metricsA.width + 10, 20);
        ctx.strokeStyle = '#1a5276';
        ctx.lineWidth = 2;
        ctx.strokeRect(labelAx - metricsA.width/2 - 5, labelAy - 16, metricsA.width + 10, 20);
        
        ctx.fillStyle = '#fff';
        ctx.fillText(textA, labelAx, labelAy);
        
        // Плоскость B
        const labelBx = px + rampBLen * 0.7 * Math.cos(angB) + Math.sin(angB) * rampWidth * 0.5;
        const labelBy = py + rampBLen * 0.7 * Math.sin(angB) + Math.cos(angB) * rampWidth * 0.5;
        const textB = `β=${state.angB}° μ=${state.muB}`;
        const metricsB = ctx.measureText(textB);
        
        ctx.fillStyle = 'rgba(231, 76, 60, 0.8)';
        ctx.fillRect(labelBx - metricsB.width/2 - 5, labelBy - 16, metricsB.width + 10, 20);
        ctx.strokeStyle = '#922b21';
        ctx.lineWidth = 2;
        ctx.strokeRect(labelBx - metricsB.width/2 - 5, labelBy - 16, metricsB.width + 10, 20);
        
        ctx.fillStyle = '#fff';
        ctx.fillText(textB, labelBx, labelBy);
        
        // Визуализация угла наклона A (дуга)
        ctx.strokeStyle = 'rgba(52, 152, 219, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const arcRadiusA = 60;
        ctx.arc(px, py, arcRadiusA, 0, -angA, true);
        ctx.stroke();
        
        // Визуализация угла наклона B (дуга)
        ctx.strokeStyle = 'rgba(231, 76, 60, 0.6)';
        ctx.beginPath();
        const arcRadiusB = 60;
        ctx.arc(px, py, arcRadiusB, 0, angB, false);
        ctx.stroke();
        
        ctx.restore();

        // Pulley (блок) - красивый металлический вид
        const visR = Math.max(25, state.R_p * 250); 
        
        // Тень с размытием
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 15;
        ctx.shadowOffsetX = 5;
        ctx.shadowOffsetY = 5;
        
        // Блок с радиальным градиентом (металлический эффект)
        const pulleyGrad = ctx.createRadialGradient(px - visR * 0.3, py - visR * 0.3, visR * 0.1, px, py, visR);
        pulleyGrad.addColorStop(0, '#9e9e9e');
        pulleyGrad.addColorStop(0.4, '#757575');
        pulleyGrad.addColorStop(0.7, '#5a5a5a');
        pulleyGrad.addColorStop(1, '#424242');
        
        ctx.fillStyle = pulleyGrad;
        ctx.beginPath();
        ctx.arc(px, py, visR, 0, 2 * PI);
        ctx.fill();
        
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        // Обводка блока
        ctx.strokeStyle = '#2c2c2c';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Блик на блоке
        const highlightGrad = ctx.createRadialGradient(px - visR * 0.4, py - visR * 0.4, 0, px - visR * 0.4, py - visR * 0.4, visR * 0.6);
        highlightGrad.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
        highlightGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
        highlightGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = highlightGrad;
        ctx.beginPath();
        ctx.arc(px, py, visR, 0, 2 * PI);
        ctx.fill();
        
        // Внутренний круг (ось) с градиентом
        const axleGrad = ctx.createRadialGradient(px - visR * 0.1, py - visR * 0.1, 0, px, py, visR * 0.3);
        axleGrad.addColorStop(0, '#6e6e6e');
        axleGrad.addColorStop(0.5, '#4a4a4a');
        axleGrad.addColorStop(1, '#2e2e2e');
        ctx.fillStyle = axleGrad;
        ctx.beginPath();
        ctx.arc(px, py, visR * 0.3, 0, 2 * PI);
        ctx.fill();
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Rotation (спицы для визуализации вращения) - улучшенные
        const rotation = (state.pos / Math.max(state.R_p, 0.01)); 
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(rotation);
        
        // Рисуем 4 спицы с градиентом
        for (let i = 0; i < 4; i++) {
            ctx.save();
            ctx.rotate(i * PI / 2);
            
            const spokeGrad = ctx.createLinearGradient(0, 0, visR * 0.8, 0);
            spokeGrad.addColorStop(0, '#6e6e6e');
            spokeGrad.addColorStop(0.5, '#9e9e9e');
            spokeGrad.addColorStop(1, '#6e6e6e');
            
            ctx.strokeStyle = spokeGrad;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(visR * 0.35, 0);
            ctx.lineTo(visR * 0.85, 0);
            ctx.stroke();
            
            // Маленький круг на конце спицы
            ctx.fillStyle = '#5a5a5a';
            ctx.beginPath();
            ctx.arc(visR * 0.85, 0, 4, 0, 2 * PI);
            ctx.fill();
            
            ctx.restore();
        }
        
        ctx.restore();

        // Blocks positions
        const distA = Math.max(MIN_DIST_FROM_PULLEY, BASE_DIST + state.pos); // A движется вниз при pos > 0, но не ближе MIN_DIST_FROM_PULLEY
        const distB = Math.max(MIN_DIST_FROM_PULLEY, BASE_DIST - state.pos); // B движется вверх при pos > 0, но не ближе MIN_DIST_FROM_PULLEY
        
        const blockH = 35;
        const blockW = 55;
        
        // Позиция точки на поверхности склона (центр нижней грани груза)
        const baseAx = px - distA * scale * Math.cos(angA);
        const baseAy = py + distA * scale * Math.sin(angA);
        const baseBx = px + distB * scale * Math.cos(angB);
        const baseBy = py + distB * scale * Math.sin(angB);
        
        // Груз рисуется от y=-blockH до y=0 в локальных координатах
        // После поворота на -angA, нижняя грань (y=0 в локальных координатах) должна лежать на поверхности
        // Центр груза находится в (0, -blockH/2) в локальных координатах
        // Чтобы нижняя грань (y=0) лежала на поверхности, центр должен быть смещен вверх
        // по перпендикуляру к склону на расстояние blockH/2
        // Перпендикуляр к склону A (вверх): (-sin(angA), -cos(angA))
        // Перпендикуляр к склону B (вверх): (sin(angB), -cos(angB))
        // Добавляем небольшое дополнительное смещение для визуального контакта с поверхностью
        const offsetFromSurface = blockH * 0.5 + 1;
        
        // Позиция центра груза: смещаем от точки на поверхности вверх по перпендикуляру
        // Для груза A: перпендикуляр вверх = (-sin(angA), -cos(angA))
        const posAx = baseAx - Math.sin(angA) * offsetFromSurface;
        const posAy = baseAy - Math.cos(angA) * offsetFromSurface;
        
        // Для груза B: перпендикуляр вверх = (sin(angB), -cos(angB))
        const posBx = baseBx + Math.sin(angB) * offsetFromSurface;
        const posBy = baseBy - Math.cos(angB) * offsetFromSurface;
        
        // Strings (нити) - красивые с тенями
        ctx.save();
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 4;
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        
        // Точки касания нити на блоке (касательные к окружности блока)
        // Нить должна быть параллельна склону
        
        // Для груза A (слева-внизу): нить идет параллельно склону
        // Направление к грузу: (-cos(angA), sin(angA))
        // Касательная точка на блоке для нити, идущей влево-вниз:
        // Перпендикуляр к направлению нити: (sin(angA), cos(angA))
        const ropeAngleA = PI - angA; // Угол в полярных координатах
        const pulleyPointAx = px + visR * Math.cos(ropeAngleA);
        const pulleyPointAy = py + visR * Math.sin(ropeAngleA);
        
        // Для груза B (справа-внизу): нить идет параллельно склону
        // Направление к грузу: (cos(angB), sin(angB))
        // Касательная точка на блоке для нити, идущей вправо-вниз:
        const ropeAngleB = -angB; // Угол в полярных координатах
        const pulleyPointBx = px + visR * Math.cos(ropeAngleB);
        const pulleyPointBy = py + visR * Math.sin(ropeAngleB);
        
        // Точки крепления нити на грузах (верхняя центральная точка груза)
        // Грузы рисуются так, что верх находится в локальных координатах (0, -blockH)
        // Нам нужна точка привязки нити, примерно (0, -blockH*0.8) для визуальной точности
        
        // Груз A повернут на угол -angA (против часовой стрелки)
        // Локальная точка крепления: (0, -blockH*0.8)
        // После поворота на -angA:
        const localAttachY = -blockH * 0.8;
        const blockAttachAx = posAx + localAttachY * Math.sin(-angA); // = posAx - localAttachY * Math.sin(angA)
        const blockAttachAy = posAy + localAttachY * Math.cos(-angA); // = posAy + localAttachY * Math.cos(angA)
        
        // Груз B повернут на угол angB (по часовой стрелке от горизонтали)
        // Локальная точка крепления: (0, -blockH*0.8)
        // После поворота на angB:
        const blockAttachBx = posBx + localAttachY * Math.sin(angB);
        const blockAttachBy = posBy + localAttachY * Math.cos(angB);
        
        // Нить к A
        ctx.beginPath();
        ctx.moveTo(pulleyPointAx, pulleyPointAy);
        ctx.lineTo(blockAttachAx, blockAttachAy);
        ctx.stroke();
        
        // Нить к B
        ctx.beginPath();
        ctx.moveTo(pulleyPointBx, pulleyPointBy);
        ctx.lineTo(blockAttachBx, blockAttachBy);
        ctx.stroke();
        
        ctx.restore(); // Сброс всех эффектов нитей

        // Block A
        ctx.save();
        ctx.translate(posAx, posAy);
        ctx.rotate(-angA);
        
        // Тень/контакт с поверхностью (под грузом) - рисуем на поверхности (y=0)
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(-blockW/2 + 2, 0, blockW - 4, 6);
        
        // Сброс тени для самого груза
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 4;
        ctx.shadowOffsetY = 4;
        
        // Груз с градиентом для объема
        const blockAGrad = ctx.createLinearGradient(-blockW/2, -blockH, -blockW/2 + blockW, -blockH + blockH);
        blockAGrad.addColorStop(0, '#5dade2');
        blockAGrad.addColorStop(0.4, '#3498db');
        blockAGrad.addColorStop(1, '#2874a6');
        
        ctx.fillStyle = blockAGrad;
        ctx.fillRect(-blockW/2, -blockH, blockW, blockH);
        
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        // Обводка
        ctx.strokeStyle = '#1a5276';
        ctx.lineWidth = 3;
        ctx.strokeRect(-blockW/2, -blockH, blockW, blockH);
        
        // Блик на грузе
        const blockAHighlight = ctx.createLinearGradient(-blockW/2, -blockH, -blockW/2 + blockW * 0.5, -blockH + blockH * 0.5);
        blockAHighlight.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
        blockAHighlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = blockAHighlight;
        ctx.fillRect(-blockW/2, -blockH, blockW * 0.6, blockH * 0.6);
        
        // Крючок для нити (сверху по центру) - металлический
        const hookGradA = ctx.createRadialGradient(-1, localAttachY - 1, 0, 0, localAttachY, 5);
        hookGradA.addColorStop(0, '#888');
        hookGradA.addColorStop(0.5, '#555');
        hookGradA.addColorStop(1, '#333');
        
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        
        ctx.beginPath();
        ctx.arc(0, localAttachY, 5, 0, 2 * PI);
        ctx.fillStyle = hookGradA;
        ctx.fill();
        
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        // Текст
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText("A", 0, -blockH/2 + 5);
        ctx.font = '12px Arial';
        ctx.fillText(`${state.mA}кг`, 0, -blockH/2 + 20);
        ctx.restore();

        // Block B
        ctx.save();
        ctx.translate(posBx, posBy);
        ctx.rotate(angB);
        
        // Тень/контакт с поверхностью (под грузом) - рисуем на поверхности (y=0)
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(-blockW/2 + 2, 0, blockW - 4, 6);
        
        // Сброс тени для самого груза
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 4;
        ctx.shadowOffsetY = 4;
        
        // Груз с градиентом для объема
        const blockBGrad = ctx.createLinearGradient(-blockW/2, -blockH, -blockW/2 + blockW, -blockH + blockH);
        blockBGrad.addColorStop(0, '#ec7063');
        blockBGrad.addColorStop(0.4, '#e74c3c');
        blockBGrad.addColorStop(1, '#c0392b');
        
        ctx.fillStyle = blockBGrad;
        ctx.fillRect(-blockW/2, -blockH, blockW, blockH);
        
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        // Обводка
        ctx.strokeStyle = '#922b21';
        ctx.lineWidth = 3;
        ctx.strokeRect(-blockW/2, -blockH, blockW, blockH);
        
        // Блик на грузе
        const blockBHighlight = ctx.createLinearGradient(-blockW/2, -blockH, -blockW/2 + blockW * 0.5, -blockH + blockH * 0.5);
        blockBHighlight.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
        blockBHighlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = blockBHighlight;
        ctx.fillRect(-blockW/2, -blockH, blockW * 0.6, blockH * 0.6);
        
        // Крючок для нити (сверху по центру) - металлический
        const hookGradB = ctx.createRadialGradient(-1, localAttachY - 1, 0, 0, localAttachY, 5);
        hookGradB.addColorStop(0, '#888');
        hookGradB.addColorStop(0.5, '#555');
        hookGradB.addColorStop(1, '#333');
        
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        
        ctx.beginPath();
        ctx.arc(0, localAttachY, 5, 0, 2 * PI);
        ctx.fillStyle = hookGradB;
        ctx.fill();
        
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        // Текст
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText("B", 0, -blockH/2 + 5);
        ctx.font = '12px Arial';
        ctx.fillText(`${state.mB}кг`, 0, -blockH/2 + 20);
        ctx.restore();

        // Info overlay - красивая информационная панель
        ctx.save();
        
        // Полупрозрачная панель
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.strokeStyle = 'rgba(52, 152, 219, 0.8)';
        ctx.lineWidth = 3;
        const panelX = 15;
        const panelY = 15;
        const panelW = 250;
        const panelH = 105;
        ctx.fillRect(panelX, panelY, panelW, panelH);
        ctx.strokeRect(panelX, panelY, panelW, panelH);
        
        // Текст с тенью
        ctx.shadowColor = 'rgba(0,0,0,0.2)';
        ctx.shadowBlur = 2;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        
        ctx.fillStyle = '#2c3e50';
        ctx.font = 'bold 15px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(`⚡ Ускорение: ${state.acc.toFixed(3)} м/с²`, panelX + 15, panelY + 25);
        ctx.fillText(`➤ Скорость: ${state.vel.toFixed(3)} м/с`, panelX + 15, panelY + 48);
        ctx.fillText(`📍 Позиция: ${state.pos.toFixed(3)} м`, panelX + 15, panelY + 71);
        ctx.fillText(`⏱ Время: ${state.time.toFixed(2)} с`, panelX + 15, panelY + 94);
        
        ctx.restore();

        // Проверка достижения пределов
        const atLimitA = (BASE_DIST + state.pos) <= MIN_DIST_FROM_PULLEY + 0.01;
        const atLimitB = (BASE_DIST - state.pos) <= MIN_DIST_FROM_PULLEY + 0.01;
        
        // Информационная панель справа
        ctx.save();
        if (atLimitA && Math.abs(state.vel) < 0.01) {
            ctx.fillStyle = 'rgba(230, 126, 34, 0.9)';
            ctx.fillRect(W - 260, 15, 240, 35);
            ctx.strokeStyle = '#d68910';
            ctx.lineWidth = 3;
            ctx.strokeRect(W - 260, 15, 240, 35);
            
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.fillText("⚠ Груз A достиг блока!", W - 140, 40);
        } else if (atLimitB && Math.abs(state.vel) < 0.01) {
            ctx.fillStyle = 'rgba(230, 126, 34, 0.9)';
            ctx.fillRect(W - 260, 15, 240, 35);
            ctx.strokeStyle = '#d68910';
            ctx.lineWidth = 3;
            ctx.strokeRect(W - 260, 15, 240, 35);
            
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 18px Arial';
            ctx.textAlign = 'center';
            ctx.fillText("⚠ Груз B достиг блока!", W - 140, 40);
        } else if (Math.abs(state.vel) > 0.05) {
            // Направление движения с фоном
            ctx.fillStyle = 'rgba(39, 174, 96, 0.9)';
            ctx.fillRect(W - 260, 15, 240, 35);
            ctx.strokeStyle = '#1e8449';
            ctx.lineWidth = 3;
            ctx.strokeRect(W - 260, 15, 240, 35);
            
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 20px Arial';
            ctx.textAlign = 'center';
            if (state.vel > 0) {
                ctx.fillText("→ A вниз, B вверх", W - 140, 40);
            } else {
                ctx.fillText("← A вверх, B вниз", W - 140, 40);
            }
        }
        ctx.restore();

        // Static equilibrium indicator (только когда действительно в равновесии)
        if (state.isStatic) {
            ctx.save();
            
            // Полупрозрачный фон с градиентом
            const eqGrad = ctx.createLinearGradient(0, H - 100, 0, H);
            eqGrad.addColorStop(0, 'rgba(231, 76, 60, 0.2)');
            eqGrad.addColorStop(1, 'rgba(231, 76, 60, 0.3)');
            ctx.fillStyle = eqGrad;
            ctx.fillRect(0, H - 100, W, 100);
            
            // Рамка сверху
            ctx.strokeStyle = 'rgba(192, 57, 43, 0.8)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(0, H - 100);
            ctx.lineTo(W, H - 100);
            ctx.stroke();
            
            // Текст с тенью
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            
            ctx.fillStyle = '#c0392b';
            ctx.font = 'bold 28px Arial';
            ctx.textAlign = 'center';
            ctx.fillText("⚖️ СТАТИЧЕСКОЕ РАВНОВЕСИЕ", W/2, H - 55);
            
            ctx.font = 'bold 16px Arial';
            ctx.fillStyle = '#922b21';
            ctx.fillText("Силы трения удерживают систему", W/2, H - 25);
            
            ctx.restore();
        }
        
        // Force vectors (если включено)
        if (state.showComponents && !state.isStatic) {
            // Сила тяжести на A
            drawVector(ctx, posAx, posAy, 0, 60, "mg", "#666", 3);
            
            // Сила тяжести на B
            drawVector(ctx, posBx, posBy, 0, 60, "mg", "#666", 3);
            
            // Нормальная реакция A (перпендикулярно поверхности вверх)
            const nAx = -Math.sin(angA) * 50;
            const nAy = -Math.cos(angA) * 50;
            drawVector(ctx, posAx, posAy, nAx, nAy, "N", "#0066cc", 2);
            
            // Нормальная реакция B (перпендикулярно поверхности вверх)
            const nBx = Math.sin(angB) * 50;
            const nBy = -Math.cos(angB) * 50;
            drawVector(ctx, posBx, posBy, nBx, nBy, "N", "#0066cc", 2);
            
            // Сила трения (противодействует движению, вдоль склона)
            if (Math.abs(state.vel) > 0.01) {
                // Направление трения противоположно скорости
                const frictionDir = -Math.sign(state.vel);
                
                // Для A: вдоль склона
                const fAx = frictionDir * Math.cos(angA) * 40;
                const fAy = -frictionDir * Math.sin(angA) * 40;
                drawVector(ctx, posAx, posAy, fAx, fAy, "Fтр", "#e67e22", 2.5);
                
                // Для B: вдоль склона
                const fBx = -frictionDir * Math.cos(angB) * 40;
                const fBy = -frictionDir * Math.sin(angB) * 40;
                drawVector(ctx, posBx, posBy, fBx, fBy, "Fтр", "#e67e22", 2.5);
            }
        }
    }

    function drawVector(ctx, x, y, dx, dy, label, color, lineWidth = 2) {
        ctx.save();
        
        // Тень для вектора
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = lineWidth + 1;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx, y + dy);
        ctx.stroke();
        
        // Arrowhead (больше и красивее)
        const angle = Math.atan2(dy, dx);
        const headLen = 14;
        const headWidth = 8;
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx - headLen * Math.cos(angle - Math.PI/8), y + dy - headLen * Math.sin(angle - Math.PI/8));
        ctx.lineTo(x + dx - headLen * 0.6 * Math.cos(angle), y + dy - headLen * 0.6 * Math.sin(angle));
        ctx.lineTo(x + dx - headLen * Math.cos(angle + Math.PI/8), y + dy - headLen * Math.sin(angle + Math.PI/8));
        ctx.closePath();
        ctx.fill();
        
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        if (label) {
            // Фон для подписи
            ctx.font = 'bold 14px Arial';
            const metrics = ctx.measureText(label);
            const labelX = x + dx + 10;
            const labelY = y + dy - 8;
            
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillRect(labelX - 3, labelY - 14, metrics.width + 6, 18);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.strokeRect(labelX - 3, labelY - 14, metrics.width + 6, 18);
            
            ctx.fillStyle = color;
            ctx.fillText(label, labelX, labelY);
        }
        ctx.restore();
    }

    // Функция экспорта данных в CSV
    function exportToCSV() {
        if (state.history.length === 0) {
            alert('Нет данных для экспорта. Запустите симуляцию и дождитесь накопления данных.');
            return;
        }

        // Заголовки CSV
        const headers = ['Время (с)', 'Позиция (м)', 'Скорость (м/с)', 'Ускорение (м/с²)', 'Статическое равновесие'];
        
        // Параметры эксперимента
        const params = [
            `Параметры эксперимента:`,
            `Масса груза A: ${state.mA} кг`,
            `Масса груза B: ${state.mB} кг`,
            `Угол плоскости A: ${state.angA}°`,
            `Угол плоскости B: ${state.angB}°`,
            `Коэффициент трения A: ${state.muA}`,
            `Коэффициент трения B: ${state.muB}`,
            `Масса блока: ${state.M_p} кг`,
            `Радиус блока: ${(state.R_p * 100).toFixed(1)} см`,
            `Трение в оси: ${state.muAxle}`,
            `Растяжимость нити: ${state.elasticity}%`,
            `Использовать статическое трение: ${state.useStatic ? 'Да' : 'Нет'}`,
            ``
        ];

        // Данные
        const rows = state.history.map(point => [
            point.t.toFixed(6),
            point.pos.toFixed(6),
            point.vel.toFixed(6),
            point.acc.toFixed(6),
            point.isStatic ? 'Да' : 'Нет'
        ]);

        // Объединяем все в CSV
        const csvContent = [
            ...params,
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        // Создаем и скачиваем файл
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `atwood_machine_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Run init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
