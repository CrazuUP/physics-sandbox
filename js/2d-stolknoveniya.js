document.addEventListener('DOMContentLoaded', () => {
    // === КОНФИГУРАЦИЯ И СОСТОЯНИЕ ===
    const canvas = document.getElementById('collision-2d-canvas');
    const ctx = canvas.getContext('2d');

    // Элементы UI
    const ui = {
        massA: document.getElementById('collision-mass-a'),
        radiusA: document.getElementById('collision-radius-a'),
        speedA: document.getElementById('collision-speed-a'),
        angleA: document.getElementById('collision-angle-a'),
        massB: document.getElementById('collision-mass-b'),
        radiusB: document.getElementById('collision-radius-b'),
        speedB: document.getElementById('collision-speed-b'),
        angleB: document.getElementById('collision-angle-b'),
        offsetX: document.getElementById('collision-offset-x'),
        offsetY: document.getElementById('collision-offset-y'),
        restitution: document.getElementById('collision-restitution'),
        showImpulse: document.getElementById('collision-show-impulse'),
        autoZoom: document.getElementById('collision-auto-zoom'),
        btnStart: document.getElementById('collision-start'),
        btnReset: document.getElementById('collision-reset'),
        inputs: document.querySelectorAll('input[type="range"]'),
        radioMode: document.querySelectorAll('input[name="direction_mode"]')
    };

    // Состояние симуляции
    const state = {
        isRunning: false,
        bodies: [],
        collisionPoints: [], // Для визуализации вспышек при ударе
        camera: { x: 0, y: 0, scale: 1 },
        dragMode: false, // Режим "прицеливания" мышью
        draggedBody: null,
        mouse: { x: 0, y: 0, isDown: false }
    };

    // Вспомогательный класс Вектор
    class Vector {
        constructor(x, y) { this.x = x; this.y = y; }
        add(v) { return new Vector(this.x + v.x, this.y + v.y); }
        sub(v) { return new Vector(this.x - v.x, this.y - v.y); }
        mult(n) { return new Vector(this.x * n, this.y * n); }
        dot(v) { return this.x * v.x + this.y * v.y; }
        mag() { return Math.sqrt(this.x ** 2 + this.y ** 2); }
        normalize() {
            const m = this.mag();
            return m === 0 ? new Vector(0, 0) : new Vector(this.x / m, this.y / m);
        }
        angle() { return Math.atan2(this.y, this.x); }
        copy() { return new Vector(this.x, this.y); }
    }

    // Класс Тело (Шар)
    class Body {
        constructor(id, mass, radius, color) {
            this.id = id;
            this.mass = mass;
            this.radius = radius; // Визуальный радиус
            this.pos = new Vector(0, 0);
            this.vel = new Vector(0, 0);
            this.color = color;
            this.trail = []; // История позиций
            this.maxTrail = 100;
        }

        update(dt) {
            // Сохраняем след
            if (state.isRunning && (this.trail.length === 0 || this.pos.sub(this.trail[this.trail.length - 1]).mag() > 2)) {
                this.trail.push(this.pos.copy());
                if (this.trail.length > this.maxTrail) this.trail.shift();
            }

            // Движение
            this.pos = this.pos.add(this.vel.mult(dt));
        }

        draw(ctx) {
            // Рисуем след
            if (this.trail.length > 1) {
                ctx.beginPath();
                ctx.strokeStyle = this.color;
                ctx.globalAlpha = 0.3;
                ctx.lineWidth = 2;
                ctx.moveTo(this.trail[0].x, this.trail[0].y);
                for (let p of this.trail) ctx.lineTo(p.x, p.y);
                ctx.stroke();
                ctx.globalAlpha = 1.0;
            }

            // Рисуем тело с градиентом (эффект 3D)
            const gradient = ctx.createRadialGradient(
                this.pos.x - this.radius * 0.3, this.pos.y - this.radius * 0.3, this.radius * 0.1,
                this.pos.x, this.pos.y, this.radius
            );
            gradient.addColorStop(0, '#fff');
            gradient.addColorStop(0.3, this.color);
            gradient.addColorStop(1, adjustColor(this.color, -50)); // Затемнение краев

            ctx.beginPath();
            ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();

            // Обводка
            ctx.strokeStyle = '#003366';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Вектор скорости (стрелка)
            if (!state.isRunning || ui.showImpulse.checked) {
                this.drawVector(ctx, this.vel, 10, '#333');
            }
        }

        drawVector(ctx, vec, scale, color) {
            if (vec.mag() < 0.1) return;
            const end = this.pos.add(vec.mult(scale));
            const headLen = 10;
            const angle = Math.atan2(end.y - this.pos.y, end.x - this.pos.x);

            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.moveTo(this.pos.x, this.pos.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();

            // Стрелочка
            ctx.beginPath();
            ctx.fillStyle = color;
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
            ctx.fill();
        }
    }

    // === ФИЗИКА ===

    function checkCollision(b1, b2) {
        const dist = b1.pos.sub(b2.pos).mag();
        // Сумма радиусов (переводим визуальные пиксели в метры для расчета, но тут 1px = 1 unit для простоты)
        // Но! Радиусы в input заданы в "см", а позиции в "м".
        // Договоримся: на канвасе 50px = 1 метр.
        const scale = 50;
        const minDist = (b1.radius + b2.radius); // Это в пикселях

        if (dist < minDist) {
            resolveCollision(b1, b2);

            // Визуальный эффект удара
            const midPoint = b1.pos.add(b2.pos.sub(b1.pos).mult(b1.radius / (b1.radius + b2.radius)));
            state.collisionPoints.push({ pos: midPoint, life: 1.0 });

            // Расталкиваем их, чтобы не слиплись (correction)
            const overlap = minDist - dist;
            const n = b2.pos.sub(b1.pos).normalize();
            const correction = n.mult(overlap / 2);
            b2.pos = b2.pos.add(correction);
            b1.pos = b1.pos.sub(correction);
        }
    }

    function resolveCollision(b1, b2) {
        // Нормаль и тангенс
        const n = b2.pos.sub(b1.pos).normalize();
        const t = new Vector(-n.y, n.x);

        // Проекции скоростей
        const v1n = b1.vel.dot(n);
        const v1t = b1.vel.dot(t);
        const v2n = b2.vel.dot(n);
        const v2t = b2.vel.dot(t);

        // Коэффициент восстановления
        const e = parseFloat(ui.restitution.value);

        // Одномерное столкновение по нормали
        const m1 = b1.mass;
        const m2 = b2.mass;

        const v1nFinal = ((m1 - e * m2) * v1n + (1 + e) * m2 * v2n) / (m1 + m2);
        const v2nFinal = ((m2 - e * m1) * v2n + (1 + e) * m1 * v1n) / (m1 + m2);

        // Тангенциальные компоненты не меняются (нет трения)
        const v1tFinal = v1t;
        const v2tFinal = v2t;

        // Конвертируем обратно в векторы x, y
        const v1nVec = n.mult(v1nFinal);
        const v1tVec = t.mult(v1tFinal);
        const v2nVec = n.mult(v2nFinal);
        const v2tVec = t.mult(v2tFinal);

        b1.vel = v1nVec.add(v1tVec);
        b2.vel = v2nVec.add(v2tVec);
    }

    // === ИНИЦИАЛИЗАЦИЯ ===

    function initBodies() {
        const pxToMeter = 50; // Масштаб: 50 пикселей = 1 метр

        // Тело A (синее)
        const mA = parseFloat(ui.massA.value);
        const rA = parseFloat(ui.radiusA.value) * 2; // Увеличиваем визуально
        const bodyA = new Body('A', mA, rA, '#4a90e2');

        // Позиция A (всегда в центре мира изначально)
        bodyA.pos = new Vector(0, 0);

        const speedA = parseFloat(ui.speedA.value);
        const angleA = parseFloat(ui.angleA.value) * (Math.PI / 180);
        bodyA.vel = new Vector(Math.cos(angleA) * speedA, Math.sin(angleA) * speedA);

        // Тело B (красное)
        const mB = parseFloat(ui.massB.value);
        const rB = parseFloat(ui.radiusB.value) * 2;
        const bodyB = new Body('B', mB, rB, '#e74c3c');

        // Позиция B (относительно A + смещение)
        // Чтобы эксперимент был интереснее, разнесем их по оси X так, чтобы они летели навстречу или как задано
        // Для простоты: Offset задает стартовую позицию B относительно (0,0)
        // Но обычно в таких задачах их ставят слева и справа.
        // Сделаем так: А слева (-3м), Б справа (+3м) + offset.
        // Или строго следуем Offset из UI.

        const offX = parseFloat(ui.offsetX.value) * pxToMeter;
        const offY = parseFloat(ui.offsetY.value) * pxToMeter;

        // Логика стартовой позиции:
        // Если скорости направлены друг на друга, разнесем их.
        // Разместим A в -200px, B в +200px + offset
        bodyA.pos = new Vector(-150, 0);
        bodyB.pos = new Vector(150 + offX, offY);

        const speedB = parseFloat(ui.speedB.value);
        const angleB = parseFloat(ui.angleB.value) * (Math.PI / 180);
        bodyB.vel = new Vector(Math.cos(angleB) * speedB, Math.sin(angleB) * speedB);

        state.bodies = [bodyA, bodyB];
        state.collisionPoints = [];
        state.isRunning = false;

        // Сброс камеры
        state.camera.x = 0;
        state.camera.y = 0;
        state.camera.scale = 1;
    }

    // === РЕНДЕРИНГ И ЦИКЛ ===

    function drawGrid(ctx, scale, camX, camY) {
        const gridSize = 50 * scale;
        const w = canvas.width;
        const h = canvas.height;

        // Смещение фазы сетки
        const offsetX = (w / 2 - camX * scale) % gridSize;
        const offsetY = (h / 2 - camY * scale) % gridSize;

        ctx.beginPath();
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;

        for (let x = offsetX; x < w; x += gridSize) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
        }
        for (let y = offsetY; y < h; y += gridSize) {
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
        }
        ctx.stroke();

        // Оси координат (0,0)
        const originX = w / 2 - camX * scale;
        const originY = h / 2 - camY * scale;

        ctx.beginPath();
        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = 2;
        ctx.moveTo(originX, 0); ctx.lineTo(originX, h); // Y axis
        ctx.moveTo(0, originY); ctx.lineTo(w, originY); // X axis
        ctx.stroke();
    }

    function updateCamera() {
        if (!ui.autoZoom.checked) return;

        // Находим bounding box всех тел
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        state.bodies.forEach(b => {
            minX = Math.min(minX, b.pos.x - b.radius);
            maxX = Math.max(maxX, b.pos.x + b.radius);
            minY = Math.min(minY, b.pos.y - b.radius);
            maxY = Math.max(maxY, b.pos.y + b.radius);
        });

        // Центр сцены
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        // Размеры сцены
        const width = maxX - minX;
        const height = maxY - minY;

        // Целевой зум (с отступами)
        const padding = 100;
        const scaleX = canvas.width / (width + padding);
        const scaleY = canvas.height / (height + padding);
        let targetScale = Math.min(scaleX, scaleY);

        // Ограничения зума
        targetScale = Math.min(Math.max(targetScale, 0.2), 1.5);

        // Плавная интерполяция
        state.camera.x += (centerX - state.camera.x) * 0.1;
        state.camera.y += (centerY - state.camera.y) * 0.1;
        state.camera.scale += (targetScale - state.camera.scale) * 0.1;
    }

    function loop() {
        // Очистка
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Обновление физики
        if (state.isRunning) {
            // Множественные подшаги для точности
            const steps = 5;
            const dt = 0.1 / steps; // Замедленное время для красоты
            for (let i = 0; i < steps; i++) {
                state.bodies.forEach(b => b.update(dt));
                checkCollision(state.bodies[0], state.bodies[1]);
            }
        }

        updateCamera();

        // Трансформация камеры
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(state.camera.scale, state.camera.scale);
        ctx.translate(-state.camera.x, -state.camera.y);

        // Отрисовка сетки (с учетом трансформации нужно хитрить,
        // но проще нарисовать ее ДО трансформации или использовать мировые координаты.
        // Для простоты, вызовем отдельную функцию с параметрами камеры).
        ctx.restore(); // Сбрасываем чтобы нарисовать фон
        drawGrid(ctx, state.camera.scale, state.camera.x, state.camera.y);

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(state.camera.scale, state.camera.scale);
        ctx.translate(-state.camera.x, -state.camera.y);

        // Отрисовка тел
        state.bodies.forEach(b => b.draw(ctx));

        // Отрисовка вспышек столкновений
        for (let i = state.collisionPoints.length - 1; i >= 0; i--) {
            const cp = state.collisionPoints[i];
            ctx.beginPath();
            ctx.arc(cp.pos.x, cp.pos.y, 20 * (1.5 - cp.life), 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 200, 0, ${cp.life})`;
            ctx.lineWidth = 3;
            ctx.stroke();
            cp.life -= 0.05;
            if (cp.life <= 0) state.collisionPoints.splice(i, 1);
        }

        // Линия прицеливания в режиме Drag
        if (!state.isRunning && state.dragMode && state.mouse.isDown && state.draggedBody) {
            const b = state.draggedBody;
            const mousePosWorld = getMouseWorldPos();

            ctx.beginPath();
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.setLineDash([5, 5]);
            ctx.moveTo(b.pos.x, b.pos.y);
            ctx.lineTo(mousePosWorld.x, mousePosWorld.y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Вектор будущей скорости (инвертированный, как в Angry Birds)
            const dragVector = b.pos.sub(mousePosWorld);
            b.drawVector(ctx, dragVector.mult(0.1), 1, b.color); // Предпросмотр
        }

        ctx.restore();

        // UI поверх канваса (Энергия и Импульс)
        drawInfoOverlay();

        requestAnimationFrame(loop);
    }

    function drawInfoOverlay() {
        const p1 = state.bodies[0].vel.mult(state.bodies[0].mass);
        const p2 = state.bodies[1].vel.mult(state.bodies[1].mass);
        const pTotal = p1.add(p2).mag().toFixed(2);

        const e1 = 0.5 * state.bodies[0].mass * state.bodies[0].vel.mag() ** 2;
        const e2 = 0.5 * state.bodies[1].mass * state.bodies[1].vel.mag() ** 2;
        const eTotal = (e1 + e2).toFixed(2);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillRect(10, 10, 200, 70);
        ctx.strokeStyle = '#003366';
        ctx.strokeRect(10, 10, 200, 70);

        ctx.font = '14px Arial';
        ctx.fillStyle = '#003366';
        ctx.fillText(`Энергия (E): ${eTotal} Дж`, 20, 35);
        ctx.fillText(`Импульс (P): ${pTotal} кг·м/с`, 20, 60);
    }

    // === УПРАВЛЕНИЕ UI ===

    function updateLabels() {
        // Обновляем все output элементы
        ui.inputs.forEach(input => {
            const output = document.getElementById(input.id + '-value');
            if (output) output.textContent = input.value;
        });
    }

    // Хелпер для цвета
    function adjustColor(color, amount) {
        return '#' + color.replace(/^#/, '').replace(/../g, color => ('0' + Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
    }

    // Преобразование координат мыши
    function getMouseWorldPos() {
        const rect = canvas.getBoundingClientRect();
        const mx = state.mouse.x - rect.left;
        const my = state.mouse.y - rect.top;

        // Обратная трансформация матрицы камеры
        const x = (mx - canvas.width / 2) / state.camera.scale + state.camera.x;
        const y = (my - canvas.height / 2) / state.camera.scale + state.camera.y;
        return new Vector(x, y);
    }

    // Слушатели событий
    ui.inputs.forEach(input => {
        input.addEventListener('input', () => {
            updateLabels();
            if (!state.isRunning) initBodies(); // Живое обновление до старта
        });
    });

    ui.btnStart.addEventListener('click', () => {
        if (state.isRunning) {
            state.isRunning = false;
            ui.btnStart.textContent = "Продолжить";
        } else {
            state.isRunning = true;
            ui.btnStart.textContent = "Пауза";
        }
    });

    ui.btnReset.addEventListener('click', () => {
        state.isRunning = false;
        ui.btnStart.textContent = "Запуск симуляции";
        initBodies();
    });

    ui.radioMode.forEach(r => {
        r.addEventListener('change', (e) => {
            state.dragMode = (e.target.value === 'drag');
            // Блокировка слайдеров углов в режиме drag
            ui.angleA.disabled = state.dragMode;
            ui.angleB.disabled = state.dragMode;
        });
    });

    // Мышь для Drag Mode
    canvas.addEventListener('mousedown', (e) => {
        if (!state.dragMode || state.isRunning) return;
        state.mouse.isDown = true;
        state.mouse.x = e.clientX;
        state.mouse.y = e.clientY;

        const mPos = getMouseWorldPos();
        // Проверка клика по телу
        state.draggedBody = state.bodies.find(b => b.pos.sub(mPos).mag() < b.radius + 10);
    });

    canvas.addEventListener('mousemove', (e) => {
        state.mouse.x = e.clientX;
        state.mouse.y = e.clientY;
    });

    canvas.addEventListener('mouseup', () => {
        if (state.dragMode && state.mouse.isDown && state.draggedBody) {
            const mPos = getMouseWorldPos();
            const pullVector = state.draggedBody.pos.sub(mPos);

            // Установка скорости на основе оттягивания (множитель силы)
            const speed = pullVector.mag() * 0.1; // коэффициент силы
            const angle = pullVector.angle();

            state.draggedBody.vel = new Vector(Math.cos(angle) * speed, Math.sin(angle) * speed);

            // Обновляем UI (обратная связь)
            const deg = (angle * 180 / Math.PI + 360) % 360;
            if (state.draggedBody.id === 'A') {
                ui.speedA.value = Math.min(speed, 15).toFixed(1);
                ui.angleA.value = deg.toFixed(0);
            } else {
                ui.speedB.value = Math.min(speed, 15).toFixed(1);
                ui.angleB.value = deg.toFixed(0);
            }
            updateLabels();
        }
        state.mouse.isDown = false;
        state.draggedBody = null;
    });

    // Запуск
    updateLabels();
    initBodies();
    loop();
});