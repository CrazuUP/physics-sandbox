// satellite-motion.js

/**
 * Моделирование движения спутника вокруг планеты - Симуляция
 * Использует закон всемирного тяготения и метод численного интегрирования
 * для построения орбиты.
 */

// --- 1. Основные константы и глобальные переменные ---
const DT = 1000;      // Шаг по времени (секунды). Используем большой шаг для космического масштаба.
const G = 6.6743e-11; // Гравитационная постоянная (Н·м²/кг²)
const CANVAS_ID = 'orbital-canvas';

let animationFrameId = null;
let simulationRunning = false;
let lastTimestamp = 0;
let totalTime = 0;

// Класс для 2D-вектора (повторное использование из первого эксперимента)
class Vector {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }
    add(v) { return new Vector(this.x + v.x, this.y + v.y); }
    subtract(v) { return new Vector(this.x - v.x, this.y - v.y); }
    scale(s) { return new Vector(this.x * s, this.y * s); }
    lengthSq() { return this.x * this.x + this.y * this.y; }
    length() { return Math.sqrt(this.lengthSq()); }
    normalize() {
        const len = this.length();
        return len > 0 ? this.scale(1 / len) : new Vector(0, 0);
    }
    copy() { return new Vector(this.x, this.y); }
}

// Физические переменные состояния спутника
let position = new Vector(0, 0); // Позиция (м)
let velocity = new Vector(0, 0); // Скорость (м/с)
let acceleration = new Vector(0, 0); // Ускорение (м/с²)
let trace = []; // Траектория спутника

// --- 2. Ссылки на DOM и Глобальные объекты ---
const canvas = document.getElementById(CANVAS_ID);
const ctx = canvas ? canvas.getContext('2d') : null;
const visualHint = document.querySelector('.visual-hint');

// Элементы управления (Inputs)
const inputs = {
    planet_mass: document.getElementById('orbital-planet-mass'),
    planet_radius: document.getElementById('orbital-planet-radius'),
    sat_mass: document.getElementById('orbital-satellite-mass'),
    sat_altitude: document.getElementById('orbital-satellite-altitude'),
    sat_speed: document.getElementById('orbital-satellite-speed'),
    sat_angle: document.getElementById('orbital-satellite-angle'),
};
const startBtn = document.getElementById('orbital-start');
const resetBtn = document.getElementById('orbital-reset');

// Элементы вывода (Outputs)
const outputs = {};
for (const key in inputs) {
    outputs[key] = document.getElementById(`orbital-${key.replace('_', '-')}-value`);
}

// Параметры симуляции
let P = {
    M: 5.972e24,     // Масса планеты (кг) - Масса Земли
    R_p: 6.371e6,    // Радиус планеты (м) - Радиус Земли
    m_sat: 1000,     // Масса спутника (кг)
    h: 500e3,        // Высота орбиты (м)
    v0: 7600,        // Начальная скорость (м/с)
    angle0_deg: 0,   // Угол скорости относительно радиус-вектора (град)
    scale_factor: 1e-6 // Масштаб: пикселей на метр. 1px = 1000 км
};

// Метрики орбиты
let M = {
    r: 0,           // Текущее расстояние до центра (м)
    v: 0,           // Текущая скорость (м/с)
    E_pot: 0,       // Потенциальная энергия (Дж)
    E_kin: 0,       // Кинетическая энергия (Дж)
    E_total: 0,     // Полная механическая энергия (Дж)
    F_grav: 0,      // Сила гравитации (Н)
    v_first_cosmic: 0 // Первая космическая скорость (м/с)
};

// --- 3. Обновление параметров и сброс состояния ---

function updateParametersFromInputs() {
    if (!inputs.planet_mass) return;

    // Планета
    // Используем множители для удобства ввода: e24 для массы, e6 для радиуса
    P.M = parseFloat(inputs.planet_mass.value) * 1e24;
    P.R_p = parseFloat(inputs.planet_radius.value) * 1e6;

    // Спутник
    P.m_sat = parseFloat(inputs.sat_mass.value);
    P.h = parseFloat(inputs.sat_altitude.value) * 1e3;
    P.v0 = parseFloat(inputs.sat_speed.value);
    P.angle0_deg = parseFloat(inputs.sat_angle.value);

    // Обновление HTML-отображения (в единицах ввода)
    outputs.planet_mass.textContent = (P.M / 1e24).toFixed(3);
    outputs.planet_radius.textContent = (P.R_p / 1e6).toFixed(3);
    outputs.sat_altitude.textContent = (P.h / 1e3).toFixed(0);
    outputs.sat_mass.textContent = P.m_sat.toFixed(0);
    outputs.sat_speed.textContent = P.v0.toFixed(0);
    outputs.sat_angle.textContent = P.angle0_deg.toFixed(0);
}

function resetState() {
    stopSimulation();
    updateParametersFromInputs();

    totalTime = 0;
    trace = [];

    // 1. Начальная позиция (на оси X)
    const initial_r = P.R_p + P.h;
    position = new Vector(initial_r, 0);

    // 2. Начальная скорость
    // Угол скорости относительно радиус-вектора (в радианах)
    const angle_rad = P.angle0_deg * PI / 180;

    // Начальная скорость направлена под углом angle_rad к оси X
    velocity = new Vector(
        P.v0 * Math.cos(angle_rad),
        P.v0 * Math.sin(angle_rad)
    );

    // 3. Расчет первой космической скорости
    M.v_first_cosmic = Math.sqrt(G * P.M / initial_r);

    // 4. Определение масштаба сцены
    const max_r = 15 * P.R_p; // Максимальный радиус для сцены (15 радиусов Земли)
    P.scale_factor = (canvas.width / 2) / max_r;

    // Начальный расчет сил и энергии
    calculateMetrics();

    drawSimulation();
    updateMetricsDisplay();
}

// --- 4. Физика: Расчет ускорения и метрик ---

function calculateAcceleration() {
    const r_vec = position.copy();
    const r = r_vec.length();

    // 1. Закон всемирного тяготения: F = G * M * m / r²
    // Ускорение: a = F / m = G * M / r²
    const r_sq = r_vec.lengthSq();
    const magnitude = G * P.M / r_sq;

    // Вектор ускорения: a = -magnitude * r_vec.normalize()
    acceleration = r_vec.normalize().scale(-magnitude);

    M.r = r;
    M.F_grav = G * P.M * P.m_sat / r_sq;
}

function calculateMetrics() {
    calculateAcceleration();

    M.v = velocity.length();

    // Энергия (Потенциальная: E_pot = -G * M * m / r)
    M.E_pot = -G * P.M * P.m_sat / M.r;
    // Кинетическая: E_kin = 0.5 * m * v²
    M.E_kin = 0.5 * P.m_sat * M.v * M.v;
    // Полная механическая
    M.E_total = M.E_kin + M.E_pot;
}

// --- 5. Ядро симуляции (Численное интегрирование) ---

function step(dt) {
    // 1. Обновление ускорения на основе текущей позиции
    calculateAcceleration();

    // 2. Интегрирование (Эйлер): обновление скорости и позиции
    velocity = velocity.add(acceleration.scale(dt));
    position = position.add(velocity.scale(dt));

    totalTime += dt;

    // 3. Обновление траектории
    trace.push(position.copy());
    // Ограничение длины траектории (10000 точек)
    if (trace.length > 10000) {
        trace.shift();
    }

    // 4. Проверка на столкновение с планетой
    if (position.length() < P.R_p) {
        // Удар: спутник вошел в радиус планеты
        position = position.normalize().scale(P.R_p);
        velocity = new Vector(0, 0);
        acceleration = new Vector(0, 0);
        stopSimulation();
    }

    // 5. Обновление метрик
    calculateMetrics();
}

// --- 6. Отрисовка (Canvas) ---

function drawSimulation() {
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const center_x = W / 2;
    const center_y = H / 2;

    ctx.clearRect(0, 0, W, H);
    ctx.save();

    // Переход в центр сцены (планета)
    ctx.translate(center_x, center_y);

    // 1. Отрисовка Траектории
    drawTrace(ctx, trace, P.scale_factor);

    // 2. Отрисовка Планеты
    const R_p_px = P.R_p * P.scale_factor;
    drawPlanet(ctx, R_p_px);

    // 3. Отрисовка Спутника
    drawSatellite(ctx, position, P.scale_factor);

    // 4. Отрисовка векторов (радиус, скорость, сила)
    if (inputs.show_vectors.checked) {
        drawVectors(ctx, position, velocity, acceleration, P.scale_factor);
    }

    ctx.restore();
}

function drawPlanet(ctx, R_px) {
    // Планета
    ctx.beginPath();
    ctx.arc(0, 0, R_px, 0, 2 * PI);
    ctx.fillStyle = '#1E88E5'; // Синий
    ctx.fill();
    ctx.strokeStyle = '#0D47A1';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Центр
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, 2 * PI);
    ctx.fillStyle = 'black';
    ctx.fill();
}

function drawSatellite(ctx, pos, scale) {
    const x = pos.x * scale;
    const y = pos.y * scale;
    const size = 6;

    // Спутник
    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * PI);
    ctx.fillStyle = '#FFC107'; // Желтый
    ctx.fill();
    ctx.strokeStyle = '#FF8F00';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Метка
    ctx.fillStyle = '#FFC107';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Спутник', x, y - 10);
}

function drawTrace(ctx, trace, scale) {
    if (trace.length < 2) return;

    ctx.beginPath();
    ctx.strokeStyle = '#388E3Caa'; // Зеленый, полупрозрачный
    ctx.lineWidth = 1.5;

    // Начинаем с самой старой точки
    const start_x = trace[0].x * scale;
    const start_y = trace[0].y * scale;
    ctx.moveTo(start_x, start_y);

    for (let i = 1; i < trace.length; i++) {
        const x = trace[i].x * scale;
        const y = trace[i].y * scale;
        ctx.lineTo(x, y);
    }
    ctx.stroke();
}

function drawVectors(ctx, pos, v_vec, a_vec, scale) {
    const x = pos.x * scale;
    const y = pos.y * scale;

    const v_scale = 3e-5; // Для скорости (м/с -> px)
    const a_scale = 5e-3; // Для ускорения (м/с² -> px)

    // Скорость (V) - Желтый
    drawVector(ctx, x, y, v_vec.scale(v_scale), '#FF8F00', 'V', 3);

    // Ускорение (A) - Красный
    drawVector(ctx, x, y, a_vec.scale(a_scale), '#D32F2F', 'A', 3);

    // Радиус-вектор (R) - Белый
    drawVector(ctx, 0, 0, pos.scale(scale), '#FFFFFF', 'R', 1, x, y);
}

function drawVector(ctx, start_x, start_y, vector_px, color, label, lineWidth, end_x_in, end_y_in) {
    const end_x = end_x_in !== undefined ? end_x_in : start_x + vector_px.x;
    const end_y = end_y_in !== undefined ? end_y_in : start_y + vector_px.y;

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;

    // Линия
    ctx.beginPath();
    ctx.moveTo(start_x, start_y);
    ctx.lineTo(end_x, end_y);
    ctx.stroke();

    // Стрелка
    const angle = Math.atan2(end_y - start_y, end_x - start_x);
    if (vector_px.length() > 2) {
        ctx.beginPath();
        ctx.moveTo(end_x, end_y);
        ctx.lineTo(end_x - 10 * Math.cos(angle - PI / 6), end_y - 10 * Math.sin(angle - PI / 6));
        ctx.moveTo(end_x, end_y);
        ctx.lineTo(end_x - 10 * Math.cos(angle + PI / 6), end_y - 10 * Math.sin(angle + PI / 6));
        ctx.stroke();
    }

    // Метка
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(label, end_x + 10 * Math.cos(angle - PI / 2), end_y + 10 * Math.sin(angle - PI / 2));
}


// --- 7. Обновление метрик в HTML ---

function updateMetricsDisplay() {
    let orbit_type = 'Неизвестно';
    const two_E_div_mu = 2 * M.E_total / (G * P.M * P.m_sat);

    if (M.E_total < 0) {
        orbit_type = 'Эллипс/Круг (E < 0)';
        if (Math.abs(M.E_kin - Math.abs(M.E_pot) / 2) < 1e-10) {
            orbit_type = 'Круг (E_kin = |E_pot|/2)';
        }
    } else if (Math.abs(M.E_total) < 1e-10) {
        orbit_type = 'Парабола (E ≈ 0)';
    } else {
        orbit_type = 'Гипербола (E > 0)';
    }

    visualHint.innerHTML = `
        <strong>Время:</strong> ${totalTime / 3600 / 24 < 1 ? (totalTime / 3600).toFixed(2) + ' ч' : (totalTime / 3600 / 24).toFixed(2) + ' дн'} | 
        <strong>Высота:</strong> ${((M.r - P.R_p) / 1000).toFixed(0)} км | 
        <strong>Скорость:</strong> ${(M.v / 1000).toFixed(2)} км/с <br>
        <strong>v<sub>1-косм</sub>:</strong> ${(M.v_first_cosmic / 1000).toFixed(2)} км/с |
        <strong>E<sub>общ</sub>:</strong> ${(M.E_total / 1e12).toFixed(3)}·10¹² Дж | 
        <strong>Тип орбиты:</strong> ${orbit_type}
    `;
}

// --- 8. Главный цикл и управление ---

function animationLoop(timestamp) {
    if (!simulationRunning) return;

    if (!lastTimestamp) lastTimestamp = timestamp;

    // Динамический DT: чем дальше и медленнее, тем больше шаг
    const current_dt = DT;

    let deltaTime = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    let stepsToRun = Math.floor(deltaTime * 1000 / current_dt);
    stepsToRun = Math.min(stepsToRun, 5); // Ограничение шагов на кадр

    for (let i = 0; i < stepsToRun; i++) {
        step(current_dt);
    }

    drawSimulation();
    updateMetricsDisplay();

    if (simulationRunning && velocity.length() > 0.01) {
        animationFrameId = requestAnimationFrame(animationLoop);
    } else {
        stopSimulation();
    }
}

function startSimulation() {
    if (simulationRunning) {
        stopSimulation();
        return;
    }

    resetState();

    simulationRunning = true;
    startBtn.textContent = 'Остановить симуляцию';
    startBtn.classList.add('active-sim');

    lastTimestamp = 0;
    animationFrameId = requestAnimationFrame(animationLoop);
}

function stopSimulation() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    simulationRunning = false;
    startBtn.textContent = 'Запуск симуляции';
    startBtn.classList.remove('active-sim');
}

// --- 9. Привязка событий ---

function setupEventListeners() {
    // Получаем чекбокс "Показать векторы"
    inputs.show_vectors = document.getElementById('orbital-show-vectors');

    if (!startBtn || !resetBtn) return;

    startBtn.addEventListener('click', startSimulation);
    resetBtn.addEventListener('click', resetState);

    // Привязка слушателей к изменению параметров
    const controls = document.querySelectorAll('.controls-form input[type="range"]');
    controls.forEach(control => {
        control.addEventListener('input', () => {
            if (!simulationRunning) {
                updateParametersFromInputs();
                resetState();
            }
        });
    });

    // Привязка к чекбоксу для отрисовки
    inputs.show_vectors.addEventListener('change', () => {
        if (!simulationRunning) {
            drawSimulation();
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (canvas) {
        setupEventListeners();
        resetState();
    }
});