document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('cart-spring-canvas');
    const ctx = canvas.getContext('2d');

    // Настройка range и output
    const parameters = [
        { id: 'cart-mass', min: 0.5, max: 100, step: 0.1 },
        { id: 'cart-speed', min: 0, max: 50, step: 0.5 },
        { id: 'cart-friction', min: 0, max: 1, step: 0.01 },
        { id: 'cart-position', min: 0.1, max: 5, step: 0.1 }, // Начальное расстояние (м)
        { id: 'spring-stiffness', min: 50, max: 5000, step: 10 },
        { id: 'spring-preload', min: 0, max: 20, step: 0.5 }, // Преднатяг (см)
        { id: 'cart-damping', min: 0, max: 2, step: 0.01 },
        { id: 'contact-restitution', min: 0, max: 1, step: 0.05 },
        { id: 'track-angle', min: 0, max: 45, step: 1 }
    ];

    parameters.forEach(param => {
        const range = document.getElementById(param.id);
        if (!range) return;
        const number = document.getElementById(`${param.id}-number`);
        const output = document.getElementById(`${param.id}-value`);

        if (range && number && output) {
            range.addEventListener('input', () => {
                const val = parseFloat(range.value).toFixed(2);
                number.value = val;
                output.value = val;
            });

            number.addEventListener('input', () => {
                let val = parseFloat(number.value);
                if (isNaN(val) || val < param.min) val = param.min;
                if (val > param.max) val = param.max;
                number.value = val.toFixed(2);
                range.value = val;
                output.value = val.toFixed(2);
            });
            // Инициализация
            const val = parseFloat(range.value).toFixed(2);
            number.value = val;
            output.value = val;
        }
    });

    // --- ЛОГИКА ИСТОРИИ (СВЕРНУТЬ/РАЗВЕРНУТЬ) ---
    const historyBtn = document.getElementById('toggle-history-btn');
    const historyContainer = document.getElementById('history-container');

    if (historyBtn && historyContainer) {
        historyContainer.style.display = 'none';
        historyBtn.addEventListener('click', () => {
            if (historyContainer.style.display === 'none') {
                historyContainer.style.display = 'block';
                historyBtn.textContent = 'Скрыть историю экспериментов';
            } else {
                historyContainer.style.display = 'none';
                historyBtn.textContent = 'Показать историю экспериментов';
            }
        });
    }

    // Переменные состояния
    let paused = true;
    let graphs_paused = false;
    let x, v, t, in_contact, v_impact;
    let attached = false;
    let times = [], forces = [], ek = [], epr = [];
    let csvData = [];
    let data_timer = 0;
    let max_x = 0;
    let initial_ek = 0;
    let max_t = 0.5;

    // Максимумы
    let max_e_k = 0;
    let max_e_pr = 0;
    let max_force = 0;
    let min_force = 0;

    // Текущие значения для отображения
    let cur_ek = 0;
    let cur_epr = 0;
    let cur_force = 0;

    let lastTime = 0;
    let c = 0;
    let countdown = 0;
    let v_initial = 0;
    let v_after = 0;
    let bounced = false;

    let experimentHistory = [];

    // Константы рисования
    const scale = 100; // px/m
    const spring_rest_px = 500;
    const wall_px = 700;
    const uncompressed_px = 150;
    const uncompressed_length = uncompressed_px / scale;
    const cart_width = 50;

    // Графики
    const graph_height = 130;
    const graph_force_height = 150;
    const graph_e_left = 50;
    const graph_f_left = 500;
    const graph_bottom = 420;
    const graph_width = 350;

    const g = 9.81;

    let m, v0, friction, position, k, preload, damping, restitution, stick_mode, show_force, show_energy;
    let angle_deg, angle_rad, slow_motion;

    // --- ЗАПУСК ---
    document.getElementById('cart-start').addEventListener('click', () => {
        m = parseFloat(document.getElementById('cart-mass').value);
        v0 = parseFloat(document.getElementById('cart-speed').value);
        friction = parseFloat(document.getElementById('cart-friction').value);

        const posInput = document.getElementById('cart-position');
        position = posInput ? parseFloat(posInput.value) : 1.5;

        k = parseFloat(document.getElementById('spring-stiffness').value);

        // Преднатяг (см -> м)
        const preloadInput = document.getElementById('spring-preload');
        preload = preloadInput ? parseFloat(preloadInput.value) / 100 : 0; // делим на 100 (см -> м)

        damping = parseFloat(document.getElementById('cart-damping').value);
        const restInput = document.getElementById('contact-restitution');
        restitution = restInput ? parseFloat(restInput.value) : 0.8;
        angle_deg = parseFloat(document.getElementById('track-angle').value);
        angle_rad = angle_deg * Math.PI / 180;
        stick_mode = document.getElementById('contact-lock').checked;
        slow_motion = document.getElementById('slow-motion').checked;
        show_force = document.getElementById('contact-show-force').checked;
        show_energy = document.getElementById('contact-show-energy').checked;

        // Инициализация
        x = -position;
        v = v0;
        t = 0;
        attached = false;
        in_contact = false;
        v_impact = 0;
        times = [];
        forces = [];
        ek = [];
        epr = [];

        csvData = [['Time(s)', 'Position(m)', 'Velocity(m/s)', 'SpringForce(N)', 'KineticEnergy(J)', 'PotentialEnergy(J)']];

        data_timer = 0;
        max_x = 0;
        initial_ek = 0.5 * m * v0 * v0;
        c = damping * 2 * Math.sqrt(m * k);
        max_e_k = initial_ek;
        max_e_pr = 0;
        max_force = 0;
        min_force = 0;

        cur_ek = initial_ek;
        cur_epr = 0;
        cur_force = 0;

        max_t = 0.5;
        countdown = 3;
        paused = false;
        graphs_paused = false;
        lastTime = performance.now();
        v_initial = v0;
        v_after = 0;
        bounced = false;
        requestAnimationFrame(animate);
    });

    // --- СБРОС ---
    document.getElementById('cart-reset').addEventListener('click', () => {
        paused = true;
        countdown = 0;

        parameters.forEach(param => {
            const range = document.getElementById(param.id);
            if (!range) return;
            const number = document.getElementById(`${param.id}-number`);
            const output = document.getElementById(`${param.id}-value`);
            range.value = range.defaultValue;
            number.value = range.defaultValue;
            output.value = parseFloat(range.defaultValue).toFixed(2);
        });
        document.getElementById('contact-lock').checked = false;
        document.getElementById('slow-motion').checked = false;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    // --- СОХРАНЕНИЕ В ИСТОРИЮ ПРИ ОСТАНОВКЕ ---
    document.getElementById('stop-graphs').addEventListener('click', () => {
        if (!paused && !graphs_paused && t > 0.1) {
            addToHistory();
        }
        graphs_paused = true;
    });

    document.getElementById('export-data').addEventListener('click', () => {
        if (csvData.length <= 1) {
            alert('Сначала запустите симуляцию, чтобы собрать данные!');
            return;
        }
        let csvContent = csvData.map(e => e.join(",")).join("\n");
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "experiment_data.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // --- НОВАЯ ФУНКЦИЯ: ЭКСПОРТ ФОТО ГРАФИКОВ ---
    document.getElementById('export-photo').addEventListener('click', () => {
        if (!canvas || t === 0) {
            alert('Сначала запустите симуляцию, чтобы создать изображение.');
            return;
        }

        // 1. Создаем временный канвас того же размера
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        // 2. Заливаем его белым фоном (чтобы не было прозрачности)
        tempCtx.fillStyle = 'white';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // 3. Копируем основное изображение поверх белого фона
        tempCtx.drawImage(canvas, 0, 0);

        // 4. Генерируем URL из временного канваса
        const imageURL = tempCanvas.toDataURL('image/png');

        // 5. Скачиваем файл
        const link = document.createElement("a");
        link.href = imageURL;
        link.download = `experiment_snap_${new Date().getTime()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
    // --- КОНЕЦ НОВОЙ ФУНКЦИИ ---

    function addToHistory() {
        const record = {
            m: m.toFixed(1),
            v0: v_initial.toFixed(1),
            k: k.toFixed(0),
            angle: angle_deg ? angle_deg.toFixed(0) : 0,
            maxX: max_x.toFixed(3),
            maxEk: max_e_k.toFixed(2)
        };
        experimentHistory.unshift(record);
        if (experimentHistory.length > 5) experimentHistory.pop();
        renderHistory();
    }

    function renderHistory() {
        const tableBody = document.querySelector('#history-table tbody');
        if (!tableBody) return;
        tableBody.innerHTML = '';
        experimentHistory.forEach((rec, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${rec.m}</td>
                <td>${rec.v0}</td>
                <td>${rec.k}</td>
                <td>${rec.angle}°</td>
                <td>${rec.maxX}</td>
                <td>${rec.maxEk}</td>
            `;
            tableBody.appendChild(row);
        });
    }

    function drawSpring(ctx, x1, y, x2) {
        ctx.strokeStyle = '#808080';
        let dist = x2 - x1;
        if (dist < 10) dist = 10;
        let coils = 15;
        let radius = 20;
        let segmentsPerCoil = 16;
        ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 5; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y);
        for (let i = 0; i <= coils * segmentsPerCoil; i++) {
            let progress = i / (coils * segmentsPerCoil);
            let angle = progress * Math.PI * 2 * coils;
            let xPos = x1 + dist * progress;
            let yOffset = Math.sin(angle) * radius * 0.5;
            let zOffset = Math.cos(angle) * radius * 0.5;
            let depth = (zOffset + radius) / (2 * radius);
            ctx.lineWidth = 2 + depth * 2;
            ctx.lineTo(xPos, y + yOffset);
        }
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.shadowColor = 'transparent'; ctx.lineWidth = 3;
    }

    function animate(time) {
        requestAnimationFrame(animate);
        if (paused) return;

        let dt = (time - lastTime) / 1000;
        lastTime = time;
        if (dt > 0.05) dt = 0.05;

        let real_dt = dt;
        let sim_dt = dt;
        if (slow_motion) sim_dt = dt * 0.1;

        if (countdown > 0) {
            countdown -= real_dt;
            draw();
            ctx.fillStyle = '#000'; ctx.font = 'bold 40px Arial'; ctx.fillText(Math.ceil(countdown), 450, 100);
            if (countdown <= 0) { countdown = 0; t = 0; }
            return;
        }

        if (!graphs_paused) {
            const gravity_accel = g * Math.sin(angle_rad);
            let a = gravity_accel - friction * v / m;
            let f_spring = 0;
            let f_damper = 0;
            let delta = 0;
            let prev_x = x;
            let prev_v = v;

            // Контакт
            if (attached || x >= 0) {
                if (!in_contact && !attached) { in_contact = true; v_impact = v; }
                delta = x + preload;

                if (delta > uncompressed_length) {
                    delta = uncompressed_length;
                    v = -restitution * Math.abs(v);
                    x = uncompressed_length - preload;
                }
                f_spring = -k * delta;
                f_damper = -c * v;
                a += (f_spring + f_damper) / m;
            } else {
                in_contact = false;
            }

            v += a * sim_dt;
            x += v * sim_dt;

            if (x >= 0) max_x = Math.max(max_x, delta);

            if (!attached && prev_x >= 0 && x < 0) {
                v = -restitution * Math.abs(v);
                if (!bounced) { v_after = v; bounced = true; }
            }

            if (stick_mode && !attached && in_contact && prev_v > 0 && v <= 0) {
                attached = true;
            }

            t += sim_dt;
            data_timer += sim_dt;

            // Обновляем текущие значения для отображения
            cur_ek = 0.5 * m * v * v;
            cur_epr = (in_contact || attached) ? 0.5 * k * delta * delta : 0;
            cur_force = (in_contact || attached) ? Math.abs(f_spring) : 0;

            if (data_timer > 0.005) {
                let curF = (in_contact || attached) ? -f_spring : 0;

                times.push(t);
                forces.push(curF);
                ek.push(cur_ek);
                epr.push(cur_epr);

                csvData.push([t.toFixed(4), (-x).toFixed(4), v.toFixed(4), curF.toFixed(4), cur_ek.toFixed(4), cur_epr.toFixed(4)]);

                max_e_k = Math.max(max_e_k, cur_ek);
                max_e_pr = Math.max(max_e_pr, cur_epr);
                max_force = Math.max(max_force, curF);
                min_force = Math.min(min_force, curF);

                if (t > max_t) max_t += 0.5;
                data_timer = 0;
            }
        }
        draw();
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // --- РИСОВАНИЕ СЦЕНЫ С ДИНАМИЧЕСКИМ МАСШТАБОМ ---
        ctx.save();

        const pivotX = 450;
        const pivotY = 200;
        const track_end_x = 900;
        // Максимальное падение относительно Y=200, чтобы не пересекать Y=340 (верхняя граница графиков)
        const max_allowed_y_dip = 140;
        const max_x_offset = track_end_x - pivotX;

        let viewScale = 1;

        if (angle_deg > 0) {
            const current_y_dip = max_x_offset * Math.sin(angle_rad);

            if (current_y_dip > max_allowed_y_dip) {
                viewScale = max_allowed_y_dip / current_y_dip;
            }
        }

        ctx.translate(pivotX, pivotY);
        ctx.rotate(angle_rad);
        ctx.scale(viewScale, viewScale);
        ctx.translate(-pivotX, -pivotY);

        // Трек
        ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, 200); ctx.lineTo(track_end_x, 200); ctx.stroke();
        ctx.fillStyle = '#888'; ctx.fillRect(wall_px, 200 - 50, 10, 50);

        // Пружина
        let left_end = spring_rest_px;
        if (attached || x >= 0) { left_end = spring_rest_px + x * scale; }
        drawSpring(ctx, left_end, 200 - 25, wall_px);

        // Тележка
        let cart_right = spring_rest_px + x * scale;
        let cart_left = cart_right - cart_width;
        ctx.fillStyle = '#00f'; ctx.fillRect(cart_left, 200 - 50, cart_width, 50);

        ctx.restore();

        // --- ТЕКСТОВАЯ ИНФОРМАЦИЯ ---
        ctx.fillStyle = '#000'; ctx.font = '16px Arial';

        // Правый блок статистики (Максимумы)
        ctx.fillText(`Макс. сжатие: ${max_x.toFixed(2)} м`, 600, 40);
        ctx.fillText(`Макс. E_k: ${max_e_k.toFixed(2)} Дж`, 600, 60);
        ctx.fillText(`Макс. E_pr: ${max_e_pr.toFixed(2)} Дж`, 600, 80);
        ctx.fillText(`V начальная: ${v_initial.toFixed(2)} м/с`, 600, 100);
        if (angle_deg > 0) {
            ctx.fillStyle = '#d9534f'; ctx.fillText(`Наклон: ${angle_deg.toFixed(0)}°`, 600, 120);
        }

        // Левый блок (Текущее состояние)
        ctx.fillStyle = '#000';
        ctx.font = 'bold 16px Arial';
        ctx.fillText(`ТЕКУЩИЕ ЗНАЧЕНИЯ:`, 20, 30);
        ctx.font = '16px Arial';
        ctx.fillText(`E_kin: ${cur_ek.toFixed(2)} Дж`, 20, 55);
        ctx.fillText(`E_pot: ${cur_epr.toFixed(2)} Дж`, 20, 75);
        ctx.fillText(`F_spring: ${cur_force.toFixed(2)} Н`, 20, 95);

        // Координаты (чуть ниже)
        ctx.fillStyle = '#444';
        ctx.fillText(`t: ${t.toFixed(2)} с`, 20, 130);
        ctx.fillText(`x: ${(-x).toFixed(2)} м`, 120, 130);
        ctx.fillText(`v: ${v.toFixed(2)} м/с`, 220, 130);

        if (show_energy) drawGraph(graph_e_left, 'Энергия (Дж)', ek, epr, 'green', 'blue', true);
        if (show_force) drawGraph(graph_f_left, 'Сила пружины (Н)', forces, null, 'red', null, false, stick_mode ? graph_force_height : graph_height);
    }

    function drawGraph(left, label_y, data1, data2, color1, color2, is_energy = false, height = graph_height) {
        const top = graph_bottom - height;

        // Заливка фона графика белым цветом
        ctx.fillStyle = 'white';
        ctx.fillRect(left, top - 20, graph_width, height + 40);

        ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(left, top, graph_width, height);
        ctx.textAlign = 'center'; ctx.fillStyle = '#000'; ctx.fillText(label_y, left + graph_width / 2, top - 10); ctx.textAlign = 'left';

        let y_min = 0;
        let y_max = (label_y === 'Энергия (Дж)') ?
            Math.ceil((Math.max(max_e_k, max_e_pr) + 0.1) / 5) * 5 :
            Math.ceil((Math.max(Math.abs(max_force), Math.abs(min_force)) + 1) / 10) * 10;
        if (label_y !== 'Энергия (Дж)') y_min = -y_max;
        let y_range = y_max - y_min; if (y_range === 0) y_range = 10;

        let y_steps = 10;
        for (let i = 0; i <= y_steps; i++) {
            let y_val = y_min + (i / y_steps) * y_range;
            let y = graph_bottom - ((y_val - y_min) / y_range) * height;
            ctx.strokeStyle = (i === 0 || i === y_steps || Math.abs(y_val) < 0.1) ? '#888' : '#eee';
            ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + graph_width, y); ctx.stroke();
            if (i % 2 === 0) {
                ctx.fillStyle = '#000'; ctx.font = '10px Arial'; ctx.fillText(y_val.toFixed(0), left - 25, y + 4);
            }
        }

        let x_steps = 20;
        let x_step_val = max_t / x_steps;
        for (let i = 0; i <= x_steps; i++) {
            let gx = left + (i / x_steps) * graph_width;
            ctx.strokeStyle = '#eee'; ctx.beginPath(); ctx.moveTo(gx, graph_bottom); ctx.lineTo(gx, top); ctx.stroke();
            if (i % 4 === 0) {
                ctx.fillStyle = '#000'; ctx.font = '10px Arial';
                let time_val = (i * x_step_val).toFixed(1);
                ctx.fillText(time_val, gx - 5, graph_bottom + 12);
                ctx.strokeStyle = '#ccc'; ctx.beginPath(); ctx.moveTo(gx, graph_bottom); ctx.lineTo(gx, top); ctx.stroke();
            }
        }

        ctx.font = '12px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = '#000';
        ctx.fillText('Время (с)', left + graph_width / 2, graph_bottom + 30);
        ctx.textAlign = 'left'; ctx.font = '16px Arial';

        function plotLine(data, color) {
            ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
            let started = false;
            for (let i = 0; i < times.length; i++) {
                if (data[i] === undefined) continue;
                let gx = left + (times[i] / max_t) * graph_width;
                let gy = graph_bottom - ((data[i] - y_min) / y_range) * height;
                if (gy < top) gy = top; if (gy > graph_bottom) gy = graph_bottom;
                if (!started) { ctx.moveTo(gx, gy); started = true; } else { ctx.lineTo(gx, gy); }
            }
            ctx.stroke();
        }

        plotLine(data1, color1);
        if (data2) plotLine(data2, color2);

        if (is_energy) {
            ctx.fillStyle = color1; ctx.beginPath(); ctx.arc(left + 20, top - 10, 3, 0, 2*Math.PI); ctx.fill();
            ctx.fillStyle = '#000'; ctx.font='12px Arial'; ctx.fillText('E kin', left + 30, top -5);
            ctx.fillStyle = color2; ctx.beginPath(); ctx.arc(left + 80, top -5 , 3, 0, 2*Math.PI); ctx.fill();
            ctx.fillStyle = '#000'; ctx.fillText('E pot', left + 90, top - 10);
        }
    }
});
