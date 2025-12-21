(() => {
    // Физические константы
    const SIM_TARGET_DT = 1 / 240; // шаг симуляции (с)
    const MAX_GRAPH_POINTS = 1200; // максимальное количество точек для графиков
    const GRAPH_SAMPLE_DT = 1 / 60; // интервал сэмплирования для графиков (с)
    const TWO_PI = Math.PI * 2;

    const canvas = document.getElementById('disk-rotation-canvas');
    if (!canvas) {
        console.error('Canvas не найден: disk-rotation-canvas');
        return;
    }

    const ctx = canvas.getContext('2d');

    // Элементы управления
    const radiusInput = document.getElementById('disk-radius');
    const radiusOut = document.getElementById('disk-radius-value');
    const massInput = document.getElementById('disk-mass');
    const massOut = document.getElementById('disk-mass-value');
    const axisFrictionInput = document.getElementById('disk-axis-friction');
    const axisFrictionOut = document.getElementById('disk-axis-friction-value');
    const momentInertiaOut = document.getElementById('disk-moment-inertia');
    const initialOmegaInput = document.getElementById('disk-initial-omega');
    const initialOmegaOut = document.getElementById('disk-initial-omega-value');
    const torqueInput = document.getElementById('disk-torque');
    const torqueOut = document.getElementById('disk-torque-value');
    const frictionInput = document.getElementById('disk-friction');
    const frictionOut = document.getElementById('disk-friction-value');
    const observationTimeInput = document.getElementById('disk-observation-time');
    const observationTimeOut = document.getElementById('disk-observation-time-value');
    const computeStopTimeCheckbox = document.getElementById('disk-compute-stop-time');
    const showEnergyCheckbox = document.getElementById('disk-show-energy');
    const showWorkCheckbox = document.getElementById('disk-show-work');
    const startBtn = document.getElementById('disk-start');
    const resetBtn = document.getElementById('disk-reset');
    let downloadBtn = document.getElementById('disk-download-csv');

    // Создаем кнопку скачивания, если её нет
    if (!downloadBtn) {
        downloadBtn = document.createElement('button');
        downloadBtn.id = 'disk-download-csv';
        downloadBtn.type = 'button';
        downloadBtn.className = 'action-btn';
        downloadBtn.textContent = 'Скачать CSV';
        if (resetBtn && resetBtn.parentNode) {
            resetBtn.parentNode.appendChild(downloadBtn);
        }
    }

    const state = {
        running: false,
        countdown: 0, // Добавлено для отсчета
        // Параметры диска
        radius: 0.4, // м
        mass: 8, // кг
        axisFriction: 0.05, // коэффициент трения в оси
        momentInertia: 0, // момент инерции (вычисляется)
        // Динамика
        theta: 0, // угол поворота (рад)
        omega: 35, // угловая скорость (рад/с)
        alpha: 0, // угловое ускорение (рад/с²)
        // Внешние воздействия
        torque: 15, // внешний момент (Н·м)
        friction: 0.1, // коэффициент вязкого сопротивления
        // Время и данные
        t: 0,
        observationTime: 20, // с
        omegaHistory: [], // массив {t, omega, alpha, E_kin, work}
        lastGraphSampleAcc: 0,
        // Расчеты
        stopTime: null, // время до остановки (с)
        totalWork: 0 // работа внешнего момента (Дж)
    };

    function uiInit() {
        const pairs = [
            [radiusInput, radiusOut, parseFloat],
            [massInput, massOut, parseFloat],
            [axisFrictionInput, axisFrictionOut, parseFloat],
            [initialOmegaInput, initialOmegaOut, parseFloat],
            [torqueInput, torqueOut, parseFloat],
            [frictionInput, frictionOut, parseFloat],
            [observationTimeInput, observationTimeOut, parseFloat]
        ];

        pairs.forEach(([inp, out, parseFn]) => {
            const upd = () => {
                let v = inp.value;
                if (parseFn) v = parseFn(v);
                if (typeof v === 'number') {
                    if (Math.abs(v) >= 10) out.textContent = v.toFixed(1);
                    else out.textContent = (Math.round(v * 100) / 100).toString();
                } else out.textContent = v;
            };
            inp.addEventListener('input', upd);
            upd();
        });

        // Обновление момента инерции при изменении радиуса или массы
        [radiusInput, massInput].forEach(inp => {
            inp.addEventListener('input', () => {
                readUItoState();
                updateMomentInertia();
            });
        });

        startBtn.addEventListener('click', () => {
            if (!state.running) {
                readUItoState();
                initializeSimulation();
                state.countdown = 3; // Начать отсчет 3 секунды
                state.running = true;
                startBtn.textContent = 'Пауза';
                requestAnimationFrame(loop);
            } else {
                state.running = false;
                startBtn.textContent = 'Запуск симуляции';
            }
        });

        resetBtn.addEventListener('click', () => {
            state.running = false;
            startBtn.textContent = 'Запуск симуляции';
            readUItoState(true);
            initializeSimulation();
            renderAll();
        });

        downloadBtn.addEventListener('click', () => {
            exportToCSV();
        });

        [radiusInput, massInput, axisFrictionInput, initialOmegaInput,
            torqueInput, frictionInput, observationTimeInput].forEach(inp => {
            inp.addEventListener('input', () => {
                readUItoState();
                updateMomentInertia();
                if (!state.running) {
                    initializeSimulation();
                    renderAll();
                }
            });
        });

        [computeStopTimeCheckbox, showEnergyCheckbox, showWorkCheckbox].forEach(cb => {
            cb.addEventListener('change', renderAll);
        });

        window.addEventListener('resize', onResize);
        onResize();
    }

    function readUItoState(resetGraphs = false) {
        state.radius = parseFloat(radiusInput.value);
        state.mass = parseFloat(massInput.value);
        state.axisFriction = parseFloat(axisFrictionInput.value);
        state.omega = parseFloat(initialOmegaInput.value);
        state.torque = parseFloat(torqueInput.value);
        state.friction = parseFloat(frictionInput.value);
        state.observationTime = parseFloat(observationTimeInput.value);

        if (resetGraphs) {
            state.omegaHistory = [];
            state.t = 0;
            state.totalWork = 0;
            state.stopTime = null;
            state.lastGraphSampleAcc = 0;
        }
    }

    function updateMomentInertia() {
        // Момент инерции однородного диска: I = (1/2) * m * R²
        state.momentInertia = 0.5 * state.mass * state.radius * state.radius;
        momentInertiaOut.textContent = state.momentInertia.toFixed(3);
    }

    function initializeSimulation() {
        state.theta = 0;
        state.omega = parseFloat(initialOmegaInput.value);
        state.alpha = 0;
        state.t = 0;
        state.totalWork = 0;
        state.stopTime = null;
        updateMomentInertia();

        // Инициализируем историю
        const Ekin = 0.5 * state.momentInertia * state.omega * state.omega;
        state.omegaHistory = [{ t: 0, omega: state.omega, alpha: 0, Ekin: Ekin, work: 0 }];
    }

    function computeAngularAcceleration(omega, torque, friction, axisFriction, momentInertia) {
        // Момент сил трения в оси (постоянный)
        const torqueFrictionAxis = -Math.sign(omega) * axisFriction * momentInertia;

        // Момент вязкого сопротивления (пропорционален угловой скорости)
        const torqueFrictionViscous = -friction * omega;

        // Суммарный момент
        const totalTorque = torque + torqueFrictionAxis + torqueFrictionViscous;

        // Угловое ускорение: α = τ / I
        return totalTorque / momentInertia;
    }

    function stepPhysics(dt) {
        // Вычисляем угловое ускорение
        state.alpha = computeAngularAcceleration(
            state.omega,
            state.torque,
            state.friction,
            state.axisFriction,
            state.momentInertia
        );

        // Обновляем угловую скорость и угол (метод Эйлера)
        state.omega += state.alpha * dt;
        state.theta += state.omega * dt;

        // Нормализуем угол
        state.theta = state.theta % TWO_PI;
        if (state.theta < 0) state.theta += TWO_PI;

        // Вычисляем работу внешнего момента
        if (showWorkCheckbox.checked) {
            state.totalWork += state.torque * state.omega * dt;
        }

        state.t += dt;

        // Сэмплируем данные для графиков
        state.lastGraphSampleAcc += dt;
        if (state.lastGraphSampleAcc >= GRAPH_SAMPLE_DT) {
            const Ekin = 0.5 * state.momentInertia * state.omega * state.omega;
            state.omegaHistory.push({
                t: state.t,
                omega: state.omega,
                alpha: state.alpha,
                Ekin: Ekin,
                work: state.totalWork
            });

            // Ограничиваем размер истории
            if (state.omegaHistory.length > MAX_GRAPH_POINTS) {
                state.omegaHistory.shift();
            }

            state.lastGraphSampleAcc = 0;
        }

        // Вычисляем время до остановки (если включено)
        if (computeStopTimeCheckbox.checked && state.stopTime === null) {
            // Останавливаемся, если скорость близка к нулю и ускорение отрицательное
            if (Math.abs(state.omega) < 0.05) {
                // Проверяем, что скорость действительно уменьшается
                if (state.omegaHistory.length > 1) {
                    const prev = state.omegaHistory[state.omegaHistory.length - 2];
                    if (Math.abs(prev.omega) > Math.abs(state.omega)) {
                        state.stopTime = state.t;
                    }
                }
            }
        }
    }

    function fitCanvasToDisplaySize(canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(200, Math.floor(rect.width));
        const h = Math.max(120, Math.floor(rect.height));
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function onResize() {
        fitCanvasToDisplaySize(canvas);
        renderAll();
    }

    function renderAll() {
        const W = canvas.width / (window.devicePixelRatio || 1);
        const H = canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, W, H);

        // Разделяем canvas на две части: визуализация диска и графики
        const diskAreaHeight = H * 0.6;
        const graphAreaHeight = H * 0.4;
        const graphAreaY = diskAreaHeight;

        // === ОБЛАСТЬ ВИЗУАЛИЗАЦИИ ДИСКА ===
        renderDiskArea(0, 0, W, diskAreaHeight);

        // === ОБЛАСТЬ ГРАФИКОВ ===
        renderGraphArea(0, graphAreaY, W, graphAreaHeight);
    }

    function renderDiskArea(x, y, w, h) {
        const centerX = x + w / 2;
        const centerY = y + h / 2;
        const maxRadius = Math.min(w, h) * 0.35;
        const diskRadius = Math.min(maxRadius, state.radius * 100); // масштабируем для визуализации

        // Фон
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(x, y, w, h);

        // Ось вращения (вертикальная линия)
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(centerX, y + 10);
        ctx.lineTo(centerX, y + h - 10);
        ctx.stroke();

        // Подшипник/крепление оси
        ctx.fillStyle = '#666';
        ctx.beginPath();
        ctx.arc(centerX, centerY, 8, 0, TWO_PI);
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Диск
        const diskX = centerX;
        const diskY = centerY;

        // Тень диска
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.beginPath();
        ctx.ellipse(diskX + 3, diskY + 3, diskRadius, diskRadius * 0.3, 0, 0, TWO_PI);
        ctx.fill();

        // Основной диск с градиентом
        const gradient = ctx.createRadialGradient(diskX, diskY, 0, diskX, diskY, diskRadius);
        gradient.addColorStop(0, '#4a90e2');
        gradient.addColorStop(0.7, '#2c5aa0');
        gradient.addColorStop(1, '#1a3d6b');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(diskX, diskY, diskRadius, 0, TWO_PI);
        ctx.fill();

        // Обод диска
        ctx.strokeStyle = '#1a3d6b';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Маркеры на диске (для визуализации вращения)
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2;
        for (let i = 0; i < 8; i++) {
            const angle = (i * TWO_PI / 8) + state.theta;
            const x1 = diskX + Math.cos(angle) * (diskRadius * 0.7);
            const y1 = diskY + Math.sin(angle) * (diskRadius * 0.7);
            const x2 = diskX + Math.cos(angle) * (diskRadius * 0.9);
            const y2 = diskY + Math.sin(angle) * (diskRadius * 0.9);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }

        // Вектор угловой скорости (стрелка)
        if (Math.abs(state.omega) > 0.1) {
            const arrowLength = Math.min(diskRadius * 0.6, 40);
            const arrowAngle = state.theta + Math.PI / 2;
            const arrowX = diskX + Math.cos(arrowAngle) * arrowLength;
            const arrowY = diskY + Math.sin(arrowAngle) * arrowLength;

            ctx.strokeStyle = state.omega > 0 ? '#00ff00' : '#ff0000';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(diskX, diskY);
            ctx.lineTo(arrowX, arrowY);
            ctx.stroke();

            // Наконечник стрелки
            const tipAngle = arrowAngle + (state.omega > 0 ? -0.3 : 0.3);
            const tipX = arrowX + Math.cos(tipAngle) * 8;
            const tipY = arrowY + Math.sin(tipAngle) * 8;
            ctx.beginPath();
            ctx.moveTo(arrowX, arrowY);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();
        }

        // Информация о диске
        ctx.fillStyle = '#000';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('Диск', centerX - 20, y + 20);

        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#333';
        ctx.fillText(`θ = ${(state.theta * 180 / Math.PI).toFixed(1)}°`, x + 10, y + 20);
        ctx.fillText(`ω = ${state.omega.toFixed(2)} рад/с`, x + 10, y + 35);
        ctx.fillText(`α = ${state.alpha.toFixed(2)} рад/с²`, x + 10, y + 50);

        // Кинетическая энергия
        const Ekin = 0.5 * state.momentInertia * state.omega * state.omega;
        ctx.fillText(`Eкин = ${Ekin.toFixed(2)} Дж`, x + 10, y + 65);

        if (state.stopTime !== null) {
            ctx.fillStyle = '#ff0000';
            ctx.font = 'bold 10px sans-serif';
            ctx.fillText(`Остановка: t = ${state.stopTime.toFixed(2)} с`, x + 10, y + 80);
        } else if (computeStopTimeCheckbox.checked && Math.abs(state.omega) < 0.5 && state.alpha < 0) {
            ctx.fillStyle = '#ff8800';
            ctx.font = '10px sans-serif';
            ctx.fillText('Замедление...', x + 10, y + 80);
        }

        // Внешний момент
        if (Math.abs(state.torque) > 0.1) {
            ctx.fillStyle = state.torque > 0 ? '#00aa00' : '#aa0000';
            ctx.font = '9px sans-serif';
            ctx.fillText(`τ = ${state.torque.toFixed(1)} Н·м`, x + w - 120, y + 20);
        }

        // Отображение отсчета, если активен
        if (state.countdown > 0) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.font = 'bold 48px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(Math.ceil(state.countdown).toString(), centerX, centerY);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }
    }

    function renderGraphArea(x, y, w, h) {
        // Фон
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);

        if (state.omegaHistory.length < 2) return;

        const padding = 40;
        const graphW = w - 2 * padding;
        const graphH = h - 2 * padding;
        const graphX = x + padding;
        const graphY = y + padding;

        // Определяем диапазоны данных
        let maxT = Math.max(state.t, state.observationTime);
        let minOmega = Infinity, maxOmega = -Infinity;
        let minEkin = Infinity, maxEkin = -Infinity;
        let minWork = Infinity, maxWork = -Infinity;

        state.omegaHistory.forEach(p => {
            minOmega = Math.min(minOmega, p.omega);
            maxOmega = Math.max(maxOmega, p.omega);
            minEkin = Math.min(minEkin, p.Ekin);
            maxEkin = Math.max(maxEkin, p.Ekin);
            minWork = Math.min(minWork, p.work);
            maxWork = Math.max(maxWork, p.work);
        });

        // Нормализуем диапазоны, избегая нулевого диапазона
        const omegaRange = maxOmega - minOmega || 1;
        const ekinRange = maxEkin - minEkin || 1;
        const workRange = maxWork - minWork || 1;

        // Сетка и оси
        ctx.strokeStyle = '#eee';
        ctx.lineWidth = 1;

        const numDiv = 10; // Больше делений (было 5, теперь 10)

        // Горизонтальные линии (Y-деления)
        for (let i = 0; i <= numDiv; i++) {
            const ty = graphY + (graphH * i / numDiv);
            ctx.beginPath();
            ctx.moveTo(graphX, ty);
            ctx.lineTo(graphX + graphW, ty);
            ctx.stroke();
        }

        // Вертикальные линии (X-деления)
        for (let i = 0; i <= numDiv; i++) {
            const tx = graphX + (graphW * i / numDiv);
            ctx.beginPath();
            ctx.moveTo(tx, graphY);
            ctx.lineTo(tx, graphY + graphH);
            ctx.stroke();
        }

        // Оси
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(graphX, graphY + graphH);
        ctx.lineTo(graphX + graphW, graphY + graphH);
        ctx.moveTo(graphX, graphY);
        ctx.lineTo(graphX, graphY + graphH);
        ctx.stroke();

        // Подписи осей (X - время)
        ctx.fillStyle = '#333';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let i = 0; i <= numDiv; i += 2) { // Каждое второе, чтобы не залезали
            const tx = graphX + (graphW * i / numDiv);
            const value = (maxT * i / numDiv).toFixed(1);
            ctx.fillText(value, tx, graphY + graphH + 5);
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';

        // Подписи осей (Y - для omega, слева)
        ctx.textAlign = 'right';
        for (let i = 0; i <= numDiv; i += 2) { // Каждое второе, чтобы не залезали
            const ty = graphY + (graphH * i / numDiv);
            const value = (maxOmega - (omegaRange * i / numDiv)).toFixed(1);
            ctx.fillText(value, graphX - 5, ty + 3);
        }
        ctx.textAlign = 'left';

        // График угловой скорости
        if (state.omegaHistory.length > 1) {
            ctx.strokeStyle = '#0066cc';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0; i < state.omegaHistory.length; i++) {
                const p = state.omegaHistory[i];
                const px = graphX + (p.t / maxT) * graphW;
                const norm = (p.omega - minOmega) / omegaRange;
                const py = graphY + graphH - norm * graphH;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        }

        // График кинетической энергии (если включен)
        if (showEnergyCheckbox.checked && state.omegaHistory.length > 1) {
            ctx.strokeStyle = '#00aa00';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            for (let i = 0; i < state.omegaHistory.length; i++) {
                const p = state.omegaHistory[i];
                const px = graphX + (p.t / maxT) * graphW;
                const norm = (p.Ekin - minEkin) / ekinRange;
                const py = graphY + graphH - norm * graphH;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // График работы (если включен)
        if (showWorkCheckbox.checked && state.omegaHistory.length > 1) {
            ctx.strokeStyle = '#ff6600';
            ctx.lineWidth = 2;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            for (let i = 0; i < state.omegaHistory.length; i++) {
                const p = state.omegaHistory[i];
                const px = graphX + (p.t / maxT) * graphW;
                const norm = (p.work - minWork) / workRange;
                const py = graphY + graphH - norm * graphH;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Легенда
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#0066cc';
        ctx.fillText('ω (рад/с)', graphX + graphW - 100, graphY + 15);

        if (showEnergyCheckbox.checked) {
            ctx.fillStyle = '#00aa00';
            ctx.fillText('Eкин (Дж)', graphX + graphW - 100, graphY + 28);
        }

        if (showWorkCheckbox.checked) {
            ctx.fillStyle = '#ff6600';
            ctx.fillText('Работа (Дж)', graphX + graphW - 100, graphY + 41);
        }

        // Текущие значения
        const last = state.omegaHistory[state.omegaHistory.length - 1];
        ctx.fillStyle = '#333';
        ctx.font = '9px sans-serif';
        ctx.fillText(`ω = ${last.omega.toFixed(2)} рад/с`, graphX + 5, graphY + 12);
        if (showEnergyCheckbox.checked) {
            ctx.fillText(`E = ${last.Ekin.toFixed(1)} Дж`, graphX + 5, graphY + 24);
        }
        if (showWorkCheckbox.checked) {
            ctx.fillText(`A = ${last.work.toFixed(1)} Дж`, graphX + 5, graphY + 36);
        }
    }

    let lastFrameTs = null;
    function loop(ts) {
        if (!state.running) {
            lastFrameTs = null;
            return;
        }
        if (!lastFrameTs) lastFrameTs = ts;
        const realDt = Math.min(0.05, (ts - lastFrameTs) / 1000);
        lastFrameTs = ts;

        if (state.countdown > 0) {
            state.countdown -= realDt;
            if (state.countdown < 0) state.countdown = 0;
            renderAll();
            requestAnimationFrame(loop);
            return;
        }

        let acc = realDt;
        while (acc > 0) {
            const dt = Math.min(acc, SIM_TARGET_DT);
            stepPhysics(dt);
            acc -= dt;
        }

        // Останавливаем симуляцию, если достигли времени наблюдения
        if (state.t >= state.observationTime) {
            state.running = false;
            startBtn.textContent = 'Запуск симуляции';
        }

        renderAll();
        requestAnimationFrame(loop);
    }

    // Функция экспорта данных в CSV
    function exportToCSV() {
        if (state.omegaHistory.length === 0) {
            alert('Нет данных для экспорта. Запустите симуляцию и дождитесь накопления данных.');
            return;
        }

        // Заголовки CSV
        const headers = ['Время (с)', 'Угловая скорость (рад/с)', 'Угловое ускорение (рад/с²)', 'Кинетическая энергия (Дж)', 'Работа (Дж)'];

        // Параметры эксперимента
        const params = [
            `Параметры эксперимента:`,
            `Радиус диска: ${state.radius} м`,
            `Масса диска: ${state.mass} кг`,
            `Момент инерции: ${state.momentInertia.toFixed(3)} кг·м²`,
            `Начальная угловая скорость: ${parseFloat(initialOmegaInput.value)} рад/с`,
            `Внешний момент: ${state.torque} Н·м`,
            `Коэффициент трения: ${state.friction}`,
            `Трение в оси: ${state.axisFriction}`,
            `Время наблюдения: ${state.observationTime} с`,
            ``
        ];

        // Данные
        const rows = state.omegaHistory.map(point => [
            point.t.toFixed(6),
            point.omega.toFixed(6),
            point.alpha.toFixed(6),
            point.Ekin.toFixed(6),
            point.work.toFixed(6)
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
        link.setAttribute('download', `disk_rotation_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Инициализация
    uiInit();
    readUItoState(true);
    initializeSimulation();
    renderAll();

    // Автозапуск отключен - пользователь должен нажать кнопку "Запуск симуляции"

})();
