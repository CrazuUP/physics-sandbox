document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('cart-spring-canvas');
    const ctx = canvas.getContext('2d');

    // Настройка range и output, плюс number inputs
    const parameters = [
        { id: 'cart-mass', min: 0.5, max: 5, step: 0.1 },
        { id: 'cart-speed', min: 0, max: 10, step: 0.5 },
        { id: 'cart-friction', min: 0, max: 0.4, step: 0.01 },
        { id: 'cart-position', min: 0, max: 3, step: 0.1 },
        { id: 'spring-stiffness', min: 50, max: 500, step: 10 },
        { id: 'spring-preload', min: 0, max: 10, step: 0.5 },
        { id: 'cart-damping', min: 0, max: 0.5, step: 0.01 },
        { id: 'contact-restitution', min: 0, max: 1, step: 0.05 }
    ];

    parameters.forEach(param => {
        const range = document.getElementById(param.id);
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

            const val = parseFloat(range.value).toFixed(2);
            number.value = val;
            output.value = val;
        }
    });

    // Переменные состояния
    let paused = true;
    let graphs_paused = false; // Новый флаг для остановки графиков
    let x, v, t, in_contact, v_impact;
    let attached = false;
    let times = [], forces = [], ek = [], epr = [];
    let data_timer = 0;
    let max_x = 0;
    let initial_ek = 0;
    let max_t = 3; // Начальный
    let max_e_k = 0;
    let max_e_pr = 0;
    let max_force = 0;
    let min_force = 0;
    let lastTime = 0;
    let c = 0;
    let countdown = 0; // Для отсчёта
    let v_initial = 0;
    let v_after = 0;
    let bounced = false;

    // Константы рисования
    const scale = 100; // px/m
    const spring_rest_px = 500;
    const wall_px = 700;
    const uncompressed_px = 150; // Покороче
    const uncompressed_length = uncompressed_px / scale;
    const track_y = 200;
    const spring_y = track_y - 25; // Центр
    const cart_width = 50;
    const graph_height = 130;
    const graph_force_height = 150; // Чуть больше для силы, если отрицательные
    const graph_e_left = 50; // Энергия слева
    const graph_f_left = 500; // Сила справа
    const graph_bottom = 420; // Подняли выше, чтобы метки были видны (canvas height 450, +15=435 <450)

    const graph_width = 350;

    // Параметры
    let m, v0, friction, position, k, preload, damping, restitution, stick_mode, show_force, show_energy;

    // Кнопка старт
    document.getElementById('cart-start').addEventListener('click', () => {
        // Чтение параметров из range (или number, но синхронизировано)
        m = parseFloat(document.getElementById('cart-mass').value);
        v0 = parseFloat(document.getElementById('cart-speed').value);
        friction = parseFloat(document.getElementById('cart-friction').value);
        position = parseFloat(document.getElementById('cart-position').value);
        k = parseFloat(document.getElementById('spring-stiffness').value);
        preload = parseFloat(document.getElementById('spring-preload').value) / 100;
        damping = parseFloat(document.getElementById('cart-damping').value);
        restitution = parseFloat(document.getElementById('contact-restitution').value);
        stick_mode = document.getElementById('contact-lock').checked;
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
        data_timer = 0;
        max_x = 0;
        initial_ek = 0.5 * m * v0 * v0;
        c = damping * 2 * Math.sqrt(m * k);
        max_e_k = initial_ek;
        max_e_pr = 0;
        max_force = 0;
        min_force = 0;
        max_t = 3;
        countdown = 3; // Старт отсчёта 3 сек
        paused = false;
        graphs_paused = false;
        lastTime = performance.now();
        v_initial = v0;
        v_after = 0;
        bounced = false;
        requestAnimationFrame(animate);
    });

    // Кнопка сброс
    document.getElementById('cart-reset').addEventListener('click', () => {
        paused = true;
        countdown = 0;
        // Сброс input
        parameters.forEach(param => {
            const range = document.getElementById(param.id);
            const number = document.getElementById(`${param.id}-number`);
            const output = document.getElementById(`${param.id}-value`);
            range.value = range.defaultValue;
            number.value = range.defaultValue;
            output.value = parseFloat(range.defaultValue).toFixed(2);
        });
        document.getElementById('contact-lock').checked = false;
        document.getElementById('contact-show-force').checked = true;
        document.getElementById('contact-show-energy').checked = true;
        // Очистка canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });

    // Новая кнопка остановки графиков
    document.getElementById('stop-graphs').addEventListener('click', () => {
        graphs_paused = true;
    });

    // Функция рисования пружины с псевдо-3D эффектом и объёмом
    function drawSpring(ctx, x1, y, x2) {
        ctx.strokeStyle = '#808080'; // Серый
        let dist = x2 - x1;
        if (dist < 10) dist = 10; // Minimum length to prevent negative dist drawing issues
        let coils = 15; // Количество витков
        let radius = 20; // Радиус витка
        let segmentsPerCoil = 16; // Сегментов на виток для плавности

        // Тень для объёма
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 5;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;

        ctx.beginPath();
        ctx.moveTo(x1, y);

        for (let i = 0; i <= coils * segmentsPerCoil; i++) {
            let progress = i / (coils * segmentsPerCoil);
            let angle = progress * Math.PI * 2 * coils;

            let xPos = x1 + dist * progress;
            let yOffset = Math.sin(angle) * radius * 0.5; // Для спирали
            let zOffset = Math.cos(angle) * radius * 0.5;

            // Псевдо-3D через толщину
            let depth = (zOffset + radius) / (2 * radius);
            ctx.lineWidth = 2 + depth * 2;

            ctx.lineTo(xPos, y + yOffset);
        }

        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.shadowColor = 'transparent'; // Сброс тени
        ctx.lineWidth = 3; // Сброс
    }

    function animate(time) {
        requestAnimationFrame(animate);
        if (paused) return;

        let dt = (time - lastTime) / 1000;
        lastTime = time;
        if (dt > 0.05) dt = 0.05;

        if (countdown > 0) {
            countdown -= dt;
            draw();
            ctx.fillStyle = '#000';
            ctx.font = 'bold 40px Arial';
            ctx.fillText(Math.ceil(countdown), 450, 100);
            if (countdown <= 0) {
                countdown = 0;
                t = 0;
            }
            return;
        }

        let a = -friction * v / m;
        let f_spring = 0;
        let f_damper = 0;
        let delta = 0;
        let prev_x = x;
        let prev_v = v;

        if (attached || x >= 0) {
            if (!in_contact && !attached) {
                in_contact = true;
                v_impact = v;
            }
            delta = x + preload;
            if (delta > uncompressed_length) { // Hit wall if over-compress
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

        v += a * dt;
        x += v * dt;

        if (!attached && prev_x >= 0 && x < 0) {
            v = -restitution * Math.abs(v);
            x = 0;
            if (!bounced) {
                v_after = v;
                bounced = true;
            }
        }

        max_x = Math.max(max_x, delta);

        if (stick_mode && !attached && in_contact && prev_v > 0 && v <= 0) {
            attached = true;
            v = 0;
        }

        t += dt;

        data_timer += dt;
        if (data_timer > 0.02 && !graphs_paused) { // Останавливаем добавление, если graphs_paused
            times.push(t);
            forces.push(-f_spring); // Inverted sign for positive compression
            ek.push(0.5 * m * v * v);
            epr.push(0.5 * k * delta * delta);
            max_e_k = Math.max(max_e_k, ek[ek.length - 1]);
            max_e_pr = Math.max(max_e_pr, epr[epr.length - 1]);
            max_force = Math.max(max_force, forces[forces.length - 1]);
            min_force = Math.min(min_force, forces[forces.length - 1]);
            if (t > max_t) max_t += 1; // Расширяем по 1 сек
            data_timer = 0;
        }

        draw();
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Трек
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(100, track_y);
        ctx.lineTo(800, track_y);
        ctx.stroke();

        // Стена
        ctx.fillStyle = '#888';
        ctx.fillRect(wall_px, track_y - 50, 10, 50);

        // Пружина
        let left_end = spring_rest_px;
        if (attached) {
            left_end = spring_rest_px + x * scale;
        } else if (x >= 0) {
            left_end = spring_rest_px + x * scale;
        }
        drawSpring(ctx, left_end, spring_y, wall_px);

        // Тележка (синяя)
        let cart_right = left_end;
        let cart_left = cart_right - cart_width;
        if (!attached && x < 0) {
            cart_right = spring_rest_px + x * scale;
            cart_left = cart_right - cart_width;
        }
        ctx.fillStyle = '#00f';
        ctx.fillRect(cart_left, track_y - 50, cart_width, 50);

        // Текст
        ctx.fillStyle = '#000';
        ctx.font = '16px Arial';
        ctx.fillText(`Максимальное сжатие: ${max_x.toFixed(2)} м`, 600, 50);
        ctx.fillText(`Макс. кинетическая энергия: ${max_e_k.toFixed(2)} Дж`, 600, 70);
        ctx.fillText(`Макс. потенциальная энергия: ${max_e_pr.toFixed(2)} Дж`, 600, 90);
        ctx.fillText(`Макс. сила пружины: ${max_force.toFixed(2)} Н`, 600, 110);
        ctx.fillText(`Начальная скорость: ${v_initial.toFixed(2)} м/с`, 600, 130);
        if (bounced) {
            ctx.fillText(`Скорость после: ${Math.abs(v_after).toFixed(2)} м/с`, 600, 150);
        }

        // График энергии (если включен)
        if (show_energy) {
            drawGraph(graph_e_left, 'Энергия (Дж)', ek, epr, 'green', 'blue', true);
        }

        // График силы (если включен)
        if (show_force) {
            drawGraph(graph_f_left, 'Сила пружины (Н)', forces, null, 'red', null, false, stick_mode ? graph_force_height : graph_height);
        }
    }

    function drawGraph(left, label_y, data1, data2, color1, color2, is_energy = false, height = graph_height) {
        const top = graph_bottom - height;
        // Оси
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, graph_bottom);
        ctx.lineTo(left, top);
        ctx.lineTo(left + graph_width, top);
        ctx.lineTo(left + graph_width, graph_bottom);
        ctx.lineTo(left, graph_bottom);
        ctx.stroke();

        // Название наверху
        ctx.textAlign = 'center';
        ctx.fillText(label_y, left + graph_width / 2, top - 10);
        ctx.textAlign = 'left';

        // Для силы: симметричный если отрицательные
        let y_min = 0;
        let y_max = (label_y === 'Энергия (Дж)') ? Math.ceil(max_e_k / 10) * 10 : Math.ceil(Math.max(Math.abs(max_force), Math.abs(min_force)) / 10) * 10;
        if (label_y !== 'Энергия (Дж)') {
            y_min = -y_max;
        }
        let y_range = y_max - y_min;
        let y_step = y_range / 5; // 5 шагов
        for (let i = 0; i <= 5; i++) {
            let y_val = y_min + i * y_step;
            let y = graph_bottom - ( (y_val - y_min) / y_range ) * height;
            ctx.strokeStyle = '#ddd';
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(left + graph_width, y);
            ctx.stroke();
            ctx.strokeStyle = '#000';
            ctx.fillText(y_val.toFixed(0), left - 40, y + 5);
        }

        // Сетка X и метки - всегда 6 делений
        let x_steps = 6;
        let x_step = max_t / x_steps;
        for (let i = 0; i <= x_steps; i++) {
            let gx = left + (i / x_steps) * graph_width;
            ctx.strokeStyle = '#ddd';
            ctx.beginPath();
            ctx.moveTo(gx, graph_bottom);
            ctx.lineTo(gx, top);
            ctx.stroke();
            ctx.strokeStyle = '#000';
            ctx.fillText((i * x_step).toFixed(1), gx - 10, graph_bottom + 15);
        }

        // Метки - уменьшили шрифт
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Время (с)', left + graph_width / 2, graph_bottom + 30); // Подняли ниже, чтобы не перекрывать цифры
        ctx.textAlign = 'left';
        ctx.font = '16px Arial';

        // Линия data1
        ctx.strokeStyle = color1;
        ctx.beginPath();
        for (let i = 0; i < times.length; i++) {
            let gx = left + (times[i] / max_t) * graph_width;
            let gy = graph_bottom - ( (data1[i] - y_min) / y_range ) * height;
            if (i === 0) ctx.moveTo(gx, gy);
            else ctx.lineTo(gx, gy);
        }
        ctx.stroke();

        // Линия data2 (если есть)
        if (data2) {
            ctx.strokeStyle = color2;
            ctx.beginPath();
            for (let i = 0; i < times.length; i++) {
                let gx = left + (times[i] / max_t) * graph_width;
                let gy = graph_bottom - ( (data2[i] - y_min) / y_range ) * height;
                if (i === 0) ctx.moveTo(gx, gy);
                else ctx.lineTo(gx, gy);
            }
            ctx.stroke();
        }

        // Пояснения для энергии с точками
        if (is_energy) {
            // Зеленая точка
            ctx.fillStyle = color1;
            ctx.beginPath();
            ctx.arc(left - 10, graph_bottom -170, 5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.fillStyle = '#000';
            ctx.fillText('Кинетическая', left, graph_bottom -170);

            // Синяя точка
            ctx.fillStyle = color2;
            ctx.beginPath();
            ctx.arc(left - 10, graph_bottom -153, 5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.fillStyle = '#000';
            ctx.fillText('Потенциальная', left, graph_bottom -153);
        }
    }
});
