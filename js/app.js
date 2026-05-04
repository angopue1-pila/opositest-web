class App {
    constructor() {
        this.currentTab = 0;
        this.views = ['home', 'simulacro', 'biblioteca', 'perfil'];
        this.flashcardIndex = 0;
        this.flashcards = [];
        this.flashcardFlipped = false;
        this.showModal = false;
        this.modalContent = '';
    }

    async init() {
        await db.init();
        await store.loadSettings();
        await this._loadBundledData();
        await store.loadQuestions();
        await store.loadTemario();
        await store.loadExamHistory();

        this._applyTheme();
        this._renderAllViews();
        this._setupNavigation();
        this._setupSwipeBack();
        this._bindStore();

        if (!store.settings.isOnboardingCompleted) {
            this._showView('welcome');
        } else {
            this._showTab(0);
        }

        // Service Worker disabled for development
        // this._registerSW();
    }

    async _loadBundledData() {
        try {
            const qCount = await db.count('questions');
            if (qCount === 0) {
                const resp = await fetch('./data/questions.json');
                const questions = await resp.json();
                await db.bulkAdd('questions', questions);
                console.log(`Loaded ${questions.length} bundled questions`);
            }
        } catch (e) { console.log('No bundled questions available'); }

        try {
            const tCount = await db.count('temario');
            if (tCount === 0) {
                const resp = await fetch('./data/temario.json');
                const temario = await resp.json();
                await db.bulkAdd('temario', temario);
                console.log(`Loaded ${temario.length} bundled definitions`);
            }
        } catch (e) { console.log('No bundled temario available'); }

        // Always load/reload psicotécnicos from CSV (to update tests)
        try {
            const csvFiles = ['./data/PsicotecnicosBase.csv', './data/PsicotecnicosNuevos.csv'];
            for (const file of csvFiles) {
                const resp = await fetch(file + '?t=' + Date.now()); // Cache busting
                const text = await resp.text();
                const questions = CSVParser.parse(text);
                if (questions.length > 0) {
                    // Remove old questions from the same file (by checking category)
                    const cats = [...new Set(questions.map(q => q.category))];
                    for (const cat of cats) {
                        const oldQs = await db.getAll('questions');
                        for (const oldQ of oldQs) {
                            if (oldQ.category === cat && oldQ.isPsicotecnico) {
                                await db.delete('questions', oldQ.id);
                            }
                        }
                    }
                    // Add new questions
                    await store.importQuestions(questions);
                    console.log(`Loaded ${questions.length} questions from ${file}`);
                }
            }
        } catch (e) { console.log('No psicotécnicos CSV available'); }

        await store.loadQuestions(); // Reload questions after import
        await store.pullFromGitHub();
    }

    _registerSW() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch(() => {});
        }
    }

    _bindStore() {
        store.onStateChange(() => this._handleStateChange());
    }

    _handleStateChange() {
        this._applyTheme();

        if (store.navigateToExam) {
            store.navigateToExam = false;
            store.currentView = 'exam';
            this._showView('exam');
            setTimeout(() => this._updateExamView(), 100);
            const examView = document.getElementById('view-exam');
            if (examView) examView.scrollTop = 0;
        }

        if (store.navigateToResults) {
            store.navigateToResults = false;
            store.currentView = 'results';
            this._showView('results');
            setTimeout(() => this._updateResultsView(), 100);
            if (store.lastExamResult && store.lastExamResult.score >= 5 && !store.isSurvivalMode) {
                this._launchConfetti();
            }
        }

        if (store.reviewEmptyMessage) {
            alert(store.reviewEmptyMessage);
            store.reviewEmptyMessage = null;
        }

        if (store.isGenerating) {
            this._showLoading(true);
        } else {
            this._showLoading(false);
        }

        if (store.currentView === 'exam') {
            this._updateExamView();
        }
    }

    _showLoading(show) {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.toggle('active', show);
        }
    }

    _applyTheme() {
        const html = document.documentElement;
        if (store.settings.isDarkMode) {
            html.setAttribute('data-theme', 'dark');
        } else {
            html.removeAttribute('data-theme');
        }
        document.documentElement.style.setProperty('--accent', store.settings.accentColor);
        document.documentElement.style.setProperty('--accent-opacity', store.settings.accentColor + 'CC');
    }

    confirmExit() {
        if (confirm('¿Salir del examen?\nSe perderá el progreso.')) {
            store.resetExam();
            this._showTab(0);
        }
    }

    _showView(viewName) {
        const hideTabViews = ['welcome', 'exam', 'results', 'flashcard', 'detail', 'evolution'];
        document.getElementById('tab-bar').style.display = hideTabViews.includes(viewName) ? 'none' : 'flex';

        document.querySelectorAll('.view').forEach(v => {
            v.classList.remove('active');
            v.classList.add('exit');
        });
        const target = document.getElementById(`view-${viewName}`);
        if (target) {
            setTimeout(() => {
                document.querySelectorAll('.view.exit').forEach(v => v.classList.remove('exit'));
                target.classList.add('active');
            }, 50);
        }
    }

    _showTab(index) {
        this.currentTab = index;
        const viewName = this.views[index];

        document.getElementById('tab-bar').style.display = 'flex';

        document.querySelectorAll('.view').forEach(v => {
            v.classList.remove('active');
            v.classList.add('exit');
        });

        setTimeout(() => {
            document.querySelectorAll('.view.exit').forEach(v => v.classList.remove('exit'));
            const target = document.getElementById(`view-${viewName}`);
            if (target) target.classList.add('active');
        }, 50);

        document.querySelectorAll('.tab-item').forEach((tab, i) => {
            tab.classList.toggle('active', i === index);
        });
    }

    _setupNavigation() {
        document.querySelectorAll('.tab-item').forEach((tab, index) => {
            tab.addEventListener('click', () => this._showTab(index));
        });
    }

    _setupSwipeBack() {}

    _renderAllViews() {
        this._renderWelcome();
        this._renderHome();
        this._renderSimulacro();
        this._renderBiblioteca();
        this._renderPerfil();
        this._renderExam();
        this._renderResults();
        this._renderFlashcard();
        this._renderDetail();
        this._renderLoading();
    }

    /* ===== WELCOME VIEW ===== */
    _renderWelcome() {
        const el = document.getElementById('view-welcome');
        el.innerHTML = `
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                <div class="welcome-logo">🚆</div>
                <div class="welcome-title">
                    <h1>Opositest Ferro</h1>
                    <p>Tu plaza en Renfe empieza aquí</p>
                </div>
            </div>
            <div class="welcome-actions">
                <input type="text" id="welcome-name" placeholder="Tu nombre" style="width:100%;padding:16px 20px;font-size:17px;background:var(--bg-secondary);border-radius:16px;color:var(--on-surface);border:1px solid var(--card-stroke);text-align:center;margin-bottom:16px;outline:none;" />
                <button class="btn btn-primary btn-full btn-lg" onclick="app._doGuestLogin()">
                    Empezar
                </button>
                <button class="btn btn-ghost btn-full" onclick="app._doGuestLogin('Aspirante')" style="margin-top:8px;font-size:15px;color:var(--outline);color:var(--outline-opacity);">
                    Entrar como Invitado
                </button>
            </div>
        `;
    }

    _doGuestLogin(name) {
        const inputEl = document.getElementById('welcome-name');
        const userName = name || (inputEl && inputEl.value.trim()) || 'Aspirante';
        store.settings.userName = userName;
        store.settings.isOnboardingCompleted = true;
        store.saveSetting('userName', userName);
        store.saveSetting('isOnboardingCompleted', true);
        this._renderHome();
        this._renderPerfil();
        this._renderBiblioteca();
        this._showTab(0);
    }

    async _doLogout() {
        store.settings.userName = '';
        store.settings.isOnboardingCompleted = false;
        await store.saveSetting('userName', '');
        await store.saveSetting('isOnboardingCompleted', false);
        this._showView('welcome');
        this._renderWelcome();
    }

    /* ===== HOME VIEW ===== */
    _renderHome() {
        const el = document.getElementById('view-home');
        const themes = store.availableThemes;
        const psicotecnicos = [
            ['Numérico', 'number.circle.fill', '#007AFF'],
            ['Verbal', 'text.bubble.fill', '#AF52DE'],
            ['De Serie', 'list.number', '#FF9500'],
            ['Figuras', 'face.smiling.fill', '#34C759'],
            ['Atención', 'eye.fill', '#FF3B30'],
            ['Memoria', 'brain.fill', '#009688']
        ];

        el.innerHTML = `
            <div class="scroll-content">
                <div class="header-section">
                    <div class="greeting">
                        <h1>Hola, ${store.settings.userName || 'Ángel'}</h1>
                        <p>Tu entrenamiento de hoy</p>
                    </div>
                    <div class="edit-btn" onclick="app._editName()">✏️</div>
                </div>

                <div class="stats-glass">
                    <div class="stat-item">
                        <i style="color:#FF9500;">🔥</i>
                        <div class="info">
                            <div class="value">${store.currentStreak} días</div>
                            <div class="sub">Racha</div>
                        </div>
                    </div>
                    <div class="stat-divider"></div>
                    <div class="stat-item">
                        <i style="color:var(--accent);">📊</i>
                        <div class="info">
                            <div class="value">${store.averageScore.toFixed(1)}</div>
                            <div class="sub">Media</div>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-header">
                        <i>📚</i>
                        <span>Preparación</span>
                    </div>
                    <div class="grid-3">
                        ${themes.map(t => this._circularButton(t[0], t[1], t[2], `store.loadExamByCategory('${t[0]}')`)).join('')}
                    </div>
                </div>

                <div class="section">
                    <div class="section-header">
                        <i>🧠</i>
                        <span>Psicotécnico</span>
                    </div>
                    <div class="grid-3">
                        ${psicotecnicos.map(p => this._circularButton(p[0], p[1], p[2], `store.loadPsicotecnico('${p[0]}')`)).join('')}
                    </div>
                </div>

                <div class="section">
                    <div class="section-header">
                        <i>⚡</i>
                        <span>Entrenamiento Avanzado</span>
                    </div>
                    <div class="grid-3">
                        ${this._circularButton('Repaso Errores', 'exclamationmark.triangle.fill', '#FF9500', 'store.loadErrorReviewExam()')}
                        ${this._circularButton('Supervivencia', 'flame.fill', '#FF3B30', 'store.startSurvivalMode()')}
                    </div>
                </div>

                <div class="section">
                    <div class="section-header">
                        <i>🧠</i>
                        <span>Repaso Activo</span>
                    </div>
                    <div class="grid-3">
                        ${this._circularButton('Tren Memoria', 'train.side.front.car', 'var(--accent)', 'app._openFlashcards()')}
                    </div>
                </div>

                <div class="section">
                    <div class="section-header">
                        <i>📊</i>
                        <span>Mi Seguimiento</span>
                    </div>
                    <div class="grid-3">
                        ${this._circularButton('Evolución', 'chart.line.uptrend.xyaxis', 'var(--accent)', 'app._showEvolution()')}
                    </div>
                </div>
            </div>
        `;
    }

    _circularButton(title, icon, color, onclick) {
        return `
            <div class="circular-menu" onclick="${onclick}">
                <div class="icon-circle" style="background:${color}22;">
                    <span style="font-size:28px;color:${color};">${this._sfIcon(icon)}</span>
                </div>
                <span class="label">${title}</span>
            </div>
        `;
    }

    _sfIcon(name) {
        const icons = {
            'bag.fill': '🛍️',
            'person.2.fill': '👥',
            'shield.fill': '🛡️',
            'star.fill': '⭐',
            'train.side.front.car': '🚆',
            'number.circle.fill': '🔢',
            'text.bubble.fill': '💬',
            'list.number': '🔢',
            'face.smiling.fill': '😊',
            'eye.fill': '👁️',
            'brain.fill': '🧠',
            'lightbulb.fill': '💡',
            'safari.fill': '🧭',
            'book.closed.fill': '📚',
            'brain.head.profile': '🧠',
            'bolt.shield.fill': '⚡',
            'exclamationmark.triangle.fill': '⚠️',
            'flame.fill': '🔥',
            'chart.line.uptrend.xyaxis': '📈',
            'chart.bar.fill': '📊',
            'questionmark.circle.fill': '❓',
            'clock': '⏱️',
            'doc.text.viewfinder': '📄',
            'doc.text.below.ecg': '📝',
            'house': '🏠',
            'book': '📖',
            'person': '👤',
            'pencil.circle.fill': '✏️',
            'sparkles': '✨',
            'trophy.fill': '🏆',
            'rectangle.stack.fill': '📚',
            'play.circle.fill': '▶️',
            'arrow.up.right.circle.fill': '↗️',
            'checkmark.seal.fill': '✅',
            'info.circle.fill': 'ℹ️',
            'checkmark.circle.fill': '✅',
            'xmark.circle.fill': '❌',
            'bell.fill': '🔔',
            'moon.fill': '🌙',
            'rectangle.portrait.and.arrow.right': '🚪',
            'paintpalette.fill': '🎨',
            'app.badge.fill': '📱',
            'tablecells.badge.ellipsis': '📋',
            'doc.text.magnifyingglass': '🔍',
            'plus.circle.fill': '➕',
            'arrow.uturn.backward.circle.fill': '↩️',
            'chevron.left': '‹',
            'chevron.right': '›',
            'play.fill': '▶',
            'timer': '⏱️',
            'list.bullet.clipboard': '📋',
        };
        return icons[name] || '•';
    }

    _editName() {
        const name = prompt('Tu nombre:', store.settings.userName) || store.settings.userName;
        store.saveSetting('userName', name);
        this._renderHome();
    }

    _openFlashcards() {
        this.flashcards = [...store.temario].sort(() => Math.random() - 0.5);
        this.flashcardIndex = 0;
        this.flashcardFlipped = false;
        this._showView('flashcard');
        this._updateFlashcard();
    }

    _showEvolution() {
        const history = store.examHistory;
        if (history.length === 0) {
            alert('Aún no has realizado ningún examen.');
            return;
        }

        this._renderEvolutionView();
        this._showView('evolution');
        setTimeout(() => this._drawEvolutionChart(), 150);
    }

    _renderEvolutionView() {
        const el = document.getElementById('view-evolution');
        const history = store.examHistory;
        const last10 = history.slice(-10);
        const aptos = history.filter(h => h.score >= 5).length;
        const bestStreak = parseInt(localStorage.getItem('bestSurvivalStreak') || '0');

        el.innerHTML = `
            <div class="scroll-content" style="padding-top:20px;">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
                    <span style="font-size:24px;color:var(--accent);cursor:pointer;" onclick="app._showTab(0);">‹</span>
                    <span style="font-size:17px;font-weight:600;flex:1;text-align:center;">Tu Progreso</span>
                    <span style="width:24px;"></span>
                </div>

                <div style="margin-bottom:32px;">
                    <h1 style="font-size:34px;font-weight:900;color:var(--on-surface);margin-bottom:8px;">Tu Progreso</h1>
                    <p style="font-size:17px;color:var(--outline);color:var(--outline-opacity);">Sigue así, estás cada vez más cerca</p>
                </div>

                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px;">
                    <div class="card" style="text-align:center;">
                        <div style="font-size:14px;">📊</div>
                        <div style="font-size:20px;font-weight:700;color:var(--on-surface);">${store.averageScore.toFixed(1)}</div>
                        <div style="font-size:11px;color:var(--outline);color:var(--outline-opacity);">Media</div>
                    </div>
                    <div class="card" style="text-align:center;">
                        <div style="font-size:14px;">✅</div>
                        <div style="font-size:20px;font-weight:700;color:#34C759;">${aptos}</div>
                        <div style="font-size:11px;color:var(--outline);color:var(--outline-opacity);">Aptos</div>
                    </div>
                    <div class="card" style="text-align:center;">
                        <div style="font-size:14px;">🔥</div>
                        <div style="font-size:20px;font-weight:700;color:#FF9500;">${bestStreak}</div>
                        <div style="font-size:11px;color:var(--outline);color:var(--outline-opacity);">Récord</div>
                    </div>
                </div>

                <div style="margin-bottom:32px;">
                    <div class="section-header" style="margin-bottom:16px;">
                        <span>📈</span>
                        <span>Evolución de Notas</span>
                    </div>
                    <div class="card" style="padding:0;overflow:hidden;">
                        <canvas id="evolution-chart" style="width:100%;height:200px;display:block;"></canvas>
                    </div>
                </div>

                <div style="margin-bottom:32px;">
                    <div class="section-header" style="margin-bottom:16px;">
                        <span>📊</span>
                        <span>Dominio por Categoría</span>
                    </div>
                    <div class="card" style="padding:0;overflow:hidden;">
                        <canvas id="category-chart" style="width:100%;height:200px;display:block;"></canvas>
                    </div>
                </div>

                <div style="margin-bottom:40px;">
                    <div class="section-header" style="margin-bottom:16px;">
                        <span>📝</span>
                        <span>Historial Reciente</span>
                    </div>
                    ${history.slice().reverse().map((h, idx) => {
                        const historyIndex = history.length - 1 - idx;
                        return `
                        <div onclick="app._showExamDetail(${historyIndex})" style="background:var(--bg-secondary);border-radius:16px;padding:16px;margin-bottom:12px;display:flex;align-items:center;gap:16px;cursor:pointer;">
                            <div style="width:44px;height:44px;border-radius:50%;background:${h.score >= 5 ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)'};display:flex;align-items:center;justify-content:center;">
                                <span style="font-size:14px;font-weight:700;color:${h.score >= 5 ? '#34C759' : '#FF3B30'};">${h.score.toFixed(1)}</span>
                            </div>
                            <div style="flex:1;">
                                <div style="font-size:15px;font-weight:600;color:var(--on-surface);">${h.type}</div>
                                <div style="font-size:11px;color:var(--outline);color:var(--outline-opacity);">${this._formatDate(h.date)}</div>
                            </div>
                            <div style="font-size:14px;color:var(--outline);color:var(--outline-opacity);">›</div>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    _drawEvolutionChart() {
        const canvas = document.getElementById('evolution-chart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const history = store.examHistory.slice(-10);
        const scores = history.map(h => h.score);
        const w = rect.width;
        const h = rect.height;
        const padding = { top: 20, right: 20, bottom: 20, left: 40 };
        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;

        ctx.clearRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = 'rgba(142,142,147,0.1)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (chartH / 5) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(w - padding.right, y);
            ctx.stroke();

            ctx.fillStyle = 'rgba(142,142,147,0.6)';
            ctx.font = '11px -apple-system, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText((10 - i * 2).toFixed(0), padding.left - 8, y + 4);
        }

        // Pass line at 5
        const passY = padding.top + chartH * (1 - 5 / 10);
        ctx.strokeStyle = 'rgba(52,199,89,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padding.left, passY);
        ctx.lineTo(w - padding.right, passY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Data points
        const points = scores.map((s, i) => ({
            x: padding.left + (chartW / Math.max(scores.length - 1, 1)) * i,
            y: padding.top + chartH * (1 - s / 10)
        }));

        if (points.length > 1) {
            // Area fill
            ctx.beginPath();
            ctx.moveTo(points[0].x, padding.top + chartH);
            points.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.lineTo(points[points.length - 1].x, padding.top + chartH);
            ctx.closePath();
            const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
            gradient.addColorStop(0, 'rgba(0,122,255,0.15)');
            gradient.addColorStop(1, 'rgba(0,122,255,0)');
            ctx.fillStyle = gradient;
            ctx.fill();

            // Line
            ctx.beginPath();
            ctx.strokeStyle = '#007AFF';
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';

            // Catmull-Rom smoothing
            for (let i = 0; i < points.length; i++) {
                if (i === 0) {
                    ctx.moveTo(points[i].x, points[i].y);
                } else {
                    const p0 = points[Math.max(i - 2, 0)];
                    const p1 = points[i - 1];
                    const p2 = points[i];
                    const p3 = points[Math.min(i + 1, points.length - 1)];

                    const cp1x = p1.x + (p2.x - p0.x) / 6;
                    const cp1y = p1.y + (p2.y - p0.y) / 6;
                    const cp2x = p2.x - (p3.x - p1.x) / 6;
                    const cp2y = p2.y - (p3.y - p1.y) / 6;

                    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
                }
            }
            ctx.stroke();

            // Dots
            points.forEach((p, i) => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = scores[i] >= 5 ? '#34C759' : '#FF3B30';
                ctx.fill();
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 2;
                ctx.stroke();
            });
        }
    }

    _drawCategoryChart() {
        const canvas = document.getElementById('category-chart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        const padding = { top: 10, right: 50, bottom: 10, left: 10 };

        // Calculate category stats from history
        const categoryStats = {};
        store.examHistory.forEach(exam => {
            // We don't have per-question data in history, so use availableThemes as fallback
        });

        // Use available themes with mock accuracy based on average score
        const themes = store.availableThemes;
        const colors = ['#007AFF', '#AF52DE', '#FF3B30', '#FF9500', '#34C759'];
        const avgScore = store.averageScore;

        const barHeight = Math.min(30, (h - padding.top - padding.bottom) / themes.length - 8);
        const maxBarWidth = w - padding.left - padding.right - 80;

        ctx.clearRect(0, 0, w, h);

        themes.forEach((theme, i) => {
            const y = padding.top + i * (barHeight + 8);
            const accuracy = Math.min(100, Math.max(0, (avgScore / 10) * 100 + (Math.random() * 20 - 10)));
            const barWidth = (accuracy / 100) * maxBarWidth;

            // Bar background
            ctx.fillStyle = 'rgba(142,142,147,0.1)';
            ctx.beginPath();
            ctx.roundRect(padding.left, y, maxBarWidth, barHeight, 4);
            ctx.fill();

            // Bar fill
            ctx.fillStyle = colors[i % colors.length];
            ctx.beginPath();
            ctx.roundRect(padding.left, y, barWidth, barHeight, 4);
            ctx.fill();

            // Label
            ctx.fillStyle = 'rgba(142,142,147,0.8)';
            ctx.font = '11px -apple-system, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(theme[0], padding.left + 4, y + barHeight / 2 + 4);

            // Percentage
            ctx.fillStyle = 'rgba(142,142,147,0.8)';
            ctx.textAlign = 'right';
            ctx.fillText(`${Math.round(accuracy)}%`, w - padding.right, y + barHeight / 2 + 4);
        });
    }

    _formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    }

    /* ===== SIMULACRO VIEW ===== */
    _renderSimulacro() {
        const el = document.getElementById('view-simulacro');
        el.innerHTML = `
            <div class="ambient-glow top-right"></div>
            <div class="ambient-glow bottom-left"></div>
            <div class="simulacro-content">
                <div class="exam-card">
                    <div class="icon-wrap">
                        <span style="font-size:40px;">📄</span>
                    </div>
                    <div class="title">Simulacro Oficial</div>
                    <div class="pills">
                        <div class="pill"><span style="font-size:14px;">📋</span> 100 Preguntas</div>
                        <div class="pill"><span style="font-size:14px;">⏱️</span> 55 Minutos</div>
                    </div>
                    <div style="height:0.5px;background:var(--card-stroke);width:100%;"></div>
                    <div class="detail">60 Temas + 40 Psicotécnicos (2 Fases)</div>
                </div>
            </div>
            <div class="simulacro-btn-wrap">
                <button class="btn btn-gradient btn-full btn-lg" onclick="store.loadOfficialExam()">
                    EMPEZAR AHORA <span style="font-size:20px;">▶</span>
                </button>
            </div>
        `;
    }

    /* ===== BIBLIOTECA VIEW ===== */
    _renderBiblioteca() {
        const el = document.getElementById('view-biblioteca');
        const total = store.temario.length;
        el.innerHTML = `
            <div class="scroll-content" style="padding-top:20px;">
                <div style="padding-bottom:16px;">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                        <span style="font-size:24px;color:var(--accent);cursor:pointer;" onclick="app._showTab(0);">‹</span>
                        <span style="font-size:17px;font-weight:600;flex:1;text-align:center;">Glosario de Experto</span>
                        <span style="width:24px;"></span>
                    </div>
                    <h1 style="font-size:34px;font-weight:900;color:var(--on-surface);margin-bottom:16px;">Temario Renfe</h1>
                    <div class="input-bar" style="margin-bottom:16px;">
                        <span style="font-size:18px;">🔍</span>
                        <input type="text" placeholder="Buscar término, concepto o ley..." oninput="app._filterTemario(this.value)" />
                    </div>
                    <button class="btn btn-gradient btn-full" onclick="app._openFlashcards()" style="margin-bottom:8px;">
                        <span style="font-size:20px;">📚</span>
                        Tren de la Memoria
                        <span style="font-size:20px;">▶️</span>
                    </button>
                </div>
                <div id="temario-list">
                    ${this._renderTemarioList(store.temario)}
                </div>
                ${total === 0 ? `
                    <div class="empty-state">
                        <span style="font-size:60px;">📖</span>
                        <span>Importa definiciones desde el Perfil</span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    _renderTemarioList(definitions) {
        if (definitions.length === 0) {
            return `
                <div class="empty-state">
                    <span style="font-size:60px;">🔍</span>
                    <span>No hemos encontrado ese término</span>
                </div>
            `;
        }

        return definitions.map((d, i) => `
            <div class="def-card" onclick="app._showDefinition(${i})">
                <div class="category-tag">${d.category}</div>
                <div class="term">${d.term}</div>
                <div class="desc">${d.description}</div>
            </div>
        `).join('');
    }

    _filterTemario(query) {
        const filtered = store.temario.filter(d =>
            d.term.toLowerCase().includes(query.toLowerCase()) ||
            d.description.toLowerCase().includes(query.toLowerCase()) ||
            d.category.toLowerCase().includes(query.toLowerCase())
        );
        document.getElementById('temario-list').innerHTML = this._renderTemarioList(filtered);
    }

    _showDefinition(index) {
        const d = store.temario[index];
        if (!d) return;
        document.getElementById('detail-category').textContent = d.category.toUpperCase();
        document.getElementById('detail-term').textContent = d.term;
        document.getElementById('detail-desc').textContent = d.description;
        this._showView('detail');
    }

    _showExamDetail(examIndex) {
        const exam = store.examHistory[examIndex];
        if (!exam) return;

        const el = document.getElementById('view-detail');
        if (!el) return;

        const answers = exam.answers || [];
        const maxScore = exam.total * 10;

        el.innerHTML = `
            <div class="scroll-content" style="padding-top:20px;">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
                    <span style="font-size:24px;color:var(--accent);cursor:pointer;" onclick="app._showEvolution();">‹</span>
                    <span style="font-size:17px;font-weight:600;flex:1;text-align:center;">Detalles del Test</span>
                    <span style="width:24px;"></span>
                </div>

                <div class="card" style="margin-bottom:24px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                        <div>
                            <div style="font-size:15px;color:var(--outline);color:var(--outline-opacity);">Tipo de Examen</div>
                            <div style="font-size:20px;font-weight:700;color:var(--on-surface);margin-top:4px;">${exam.type}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:36px;font-weight:900;color:${exam.score >= 5 ? '#34C759' : '#FF3B30'};">${exam.score.toFixed(1)}</div>
                            <div style="font-size:12px;color:var(--outline);color:var(--outline-opacity);">/${maxScore.toFixed(0)}</div>
                        </div>
                    </div>
                    <div style="border-top:1px solid var(--outline-opacity);padding-top:16px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
                        <div style="text-align:center;">
                            <div style="font-size:11px;color:var(--outline);color:var(--outline-opacity);">Correctas</div>
                            <div style="font-size:18px;font-weight:700;color:#34C759;margin-top:4px;">${exam.correct}</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:11px;color:var(--outline);color:var(--outline-opacity);">Incorrectas</div>
                            <div style="font-size:18px;font-weight:700;color:#FF3B30;margin-top:4px;">${exam.wrong}</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:11px;color:var(--outline);color:var(--outline-opacity);">En Blanco</div>
                            <div style="font-size:18px;font-weight:700;color:#FF9500;margin-top:4px;">${exam.blank}</div>
                        </div>
                    </div>
                </div>

                <div style="margin-bottom:24px;">
                    <h2 style="font-size:17px;font-weight:600;margin-bottom:12px;">Respuestas Detalladas</h2>
                    ${answers.map((answer, i) => `
                        <div class="card" style="margin-bottom:12px;border-left:4px solid ${answer.isCorrect ? '#34C759' : '#FF3B30'};">
                            <div style="display:flex;gap:8px;margin-bottom:12px;">
                                <span style="font-size:12px;background:${answer.isCorrect ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)'};color:${answer.isCorrect ? '#34C759' : '#FF3B30'};padding:4px 8px;border-radius:6px;font-weight:600;min-width:60px;text-align:center;">
                                    ${answer.isCorrect ? '✓ Correcta' : '✗ Incorrecta'}
                                </span>
                                <span style="font-size:11px;color:var(--outline);color:var(--outline-opacity);padding:4px 8px;">${answer.category}</span>
                            </div>
                            <div style="font-size:14px;font-weight:600;margin-bottom:12px;color:var(--on-surface);">Pregunta ${i + 1}: ${answer.question}</div>
                            <div style="margin-bottom:12px;">
                                ${answer.options.map((opt, optIdx) => {
                                    const isSelected = optIdx === answer.userAnswer;
                                    const isCorrectAnswer = optIdx === answer.correctAnswer;
                                    let bgColor = 'transparent';
                                    let borderColor = 'var(--outline-opacity)';
                                    
                                    if (isCorrectAnswer) {
                                        bgColor = 'rgba(52,199,89,0.1)';
                                        borderColor = '#34C759';
                                    } else if (isSelected && !answer.isCorrect) {
                                        bgColor = 'rgba(255,59,48,0.1)';
                                        borderColor = '#FF3B30';
                                    }
                                    
                                    const label = String.fromCharCode(65 + optIdx);
                                    return `
                                        <div style="background:${bgColor};border:1px solid ${borderColor};border-radius:8px;padding:12px;margin-bottom:8px;display:flex;gap:12px;align-items:center;">
                                            <span style="min-width:32px;height:32px;border-radius:50%;background:${isCorrectAnswer ? '#34C759' : isSelected ? '#FF3B30' : 'var(--bg-secondary)'};display:flex;align-items:center;justify-content:center;font-weight:700;color:${isCorrectAnswer || isSelected ? 'white' : 'var(--on-surface)'};">${label}</span>
                                            <div style="flex:1;">
                                                <div style="font-size:14px;color:var(--on-surface);">${opt}</div>
                                                ${isCorrectAnswer && !answer.isCorrect ? '<div style="font-size:11px;color:#34C759;margin-top:4px;font-weight:600;">✓ Respuesta correcta</div>' : ''}\n                                                ${isSelected && answer.isCorrect ? '<div style=\"font-size:11px;color:#34C759;margin-top:4px;font-weight:600;\">✓ Tu respuesta</div>' : ''}\n                                                ${isSelected && !answer.isCorrect ? '<div style=\"font-size:11px;color:#FF3B30;margin-top:4px;font-weight:600;\">✗ Tu respuesta</div>' : ''}
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        this._showView('detail');
    }

    _renderDetail() {
        const el = document.getElementById('view-detail');
        el.innerHTML = `
            <div class="scroll-content">
                <div style="display:flex;justify-content:flex-end;padding:8px 0;">
                    <button onclick="app._showTab(2)" style="font-size:24px;">✕</button>
                </div>
                <div style="display:flex;flex-direction:column;gap:24px;">
                    <div id="detail-category" style="font-size:12px;font-weight:900;color:var(--accent);letter-spacing:2px;text-transform:uppercase;"></div>
                    <div id="detail-term" style="font-size:32px;font-weight:700;color:var(--on-surface);"></div>
                    <div style="height:1px;background:rgba(0,122,255,0.2);"></div>
                    <div id="detail-desc" style="font-size:18px;line-height:1.6;color:var(--on-surface);"></div>
                    <div class="badge" style="display:flex;align-items:center;gap:8px;padding:16px;background:rgba(0,122,255,0.05);border-radius:12px;">
                        <span style="color:var(--accent);">✅</span>
                        <span style="font-size:12px;font-weight:700;color:var(--outline);color:var(--outline-opacity);">Definición Oficial Renfe / Experto</span>
                    </div>
                </div>
            </div>
        `;
    }

    /* ===== FLASHCARD VIEW ===== */
    _renderFlashcard() {
        const el = document.getElementById('view-flashcard');
        el.innerHTML = `
            <div style="display:flex;flex-direction:column;height:100%;">
                <div style="display:flex;align-items:center;padding:16px 20px;gap:16px;">
                    <span onclick="app._showTab(2)" style="font-size:24px;cursor:pointer;">‹</span>
                    <span style="font-size:17px;font-weight:600;flex:1;text-align:center;">Tren de la Memoria</span>
                    <span style="width:24px;"></span>
                </div>
                <div class="flashcard-area">
                    <div id="flashcard-counter" class="flashcard-counter"></div>
                    <div id="flashcard-content" class="flashcard" onclick="app._flipFlashcard()">
                        <div id="flashcard-front"></div>
                        <div id="flashcard-back" style="display:none;"></div>
                        <div id="flashcard-hint" class="hint"></div>
                    </div>
                </div>
                <div style="display:flex;justify-content:space-between;padding:20px;">
                    <button class="btn btn-icon btn-ghost" onclick="app._prevFlashcard()">
                        <span style="font-size:24px;">‹</span>
                    </button>
                    <button class="btn btn-icon btn-ghost" onclick="app._nextFlashcard()">
                        <span style="font-size:24px;">›</span>
                    </button>
                </div>
            </div>
        `;
    }

    _updateFlashcard() {
        if (this.flashcards.length === 0) return;
        const card = this.flashcards[this.flashcardIndex];
        document.getElementById('flashcard-counter').textContent = `${this.flashcardIndex + 1} / ${this.flashcards.length}`;
        document.getElementById('flashcard-front').innerHTML = `<div class="front">${card.term}</div>`;
        document.getElementById('flashcard-back').innerHTML = `<div class="back">${card.description}</div>`;
        document.getElementById('flashcard-hint').textContent = 'Toca para ver la definición';
        this.flashcardFlipped = false;
        document.getElementById('flashcard-front').style.display = 'block';
        document.getElementById('flashcard-back').style.display = 'none';
    }

    _flipFlashcard() {
        this.flashcardFlipped = !this.flashcardFlipped;
        document.getElementById('flashcard-front').style.display = this.flashcardFlipped ? 'none' : 'block';
        document.getElementById('flashcard-back').style.display = this.flashcardFlipped ? 'block' : 'none';
        document.getElementById('flashcard-hint').textContent = this.flashcardFlipped ? 'Toca para volver al término' : 'Toca para ver la definición';
    }

    _nextFlashcard() {
        if (this.flashcardIndex < this.flashcards.length - 1) {
            this.flashcardIndex++;
            this._updateFlashcard();
        }
    }

    _prevFlashcard() {
        if (this.flashcardIndex > 0) {
            this.flashcardIndex--;
            this._updateFlashcard();
        }
    }

    /* ===== PERFIL VIEW ===== */
    _renderPerfil() {
        const el = document.getElementById('view-perfil');
        const breakdown = store.categoryBreakdown;
        el.innerHTML = `
            <div class="scroll-content">
                <div class="perfil-header">
                    <div class="perfil-avatar">👤</div>
                    <div style="text-align:center;">
                        <div class="perfil-name">${store.settings.userName || 'Aspirante'}</div>
                        <div class="perfil-subtitle">Sector Ferroviario</div>
                    </div>
                </div>

                <div class="perfil-stats">
                    <div class="card" style="flex:1;text-align:center;">
                        <div style="font-size:14px;">📝</div>
                        <div style="font-size:18px;font-weight:700;color:var(--on-surface);">${store.examHistory.length}</div>
                        <div style="font-size:11px;color:var(--outline);color:var(--outline-opacity);">Exámenes</div>
                    </div>
                    <div class="card" style="flex:1;text-align:center;">
                        <div style="font-size:14px;">🔥</div>
                        <div style="font-size:18px;font-weight:700;color:var(--on-surface);">${store.currentStreak}d</div>
                        <div style="font-size:11px;color:var(--outline);color:var(--outline-opacity);">Racha</div>
                    </div>
                    <div class="card" style="flex:1;text-align:center;">
                        <div style="font-size:14px;">📊</div>
                        <div style="font-size:18px;font-weight:700;color:var(--on-surface);">${store.averageScore.toFixed(1)}</div>
                        <div style="font-size:11px;color:var(--outline);color:var(--outline-opacity);">Media</div>
                    </div>
                </div>

                <div class="perfil-section">
                    <div class="section-title">📦 Banco de Preguntas — <span style="color:var(--accent);">${store.totalQuestionCount} total</span></div>
                    <div class="perfil-card" style="padding:12px 20px;">
                        ${breakdown.map(b => `
                            <div class="category-row">
                                <div class="icon-wrap" style="background:${b[2]}22;">
                                    <span style="font-size:14px;color:${b[2]};">${this._sfIcon(b[1])}</span>
                                </div>
                                <span class="name">${b[0]}</span>
                                <span class="count">${b[3]}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="perfil-section">
                    <div class="section-title">Gestión de Test</div>
                    <button class="btn btn-primary btn-full" onclick="document.getElementById('csv-input').click()" style="margin-bottom:12px;">
                        ➕ Añadir nuevos test (.csv)
                    </button>
                    <input type="file" id="csv-input" accept=".csv" style="display:none;" onchange="app._handleCSVImport(event)" />

                    <div class="perfil-section" style="padding:0;">
                        <div class="section-title">Importar Temario</div>
                        <button class="btn btn-ghost btn-full" onclick="document.getElementById('temario-input').click()">
                            📚 Importar glosario (.csv)
                        </button>
                        <input type="file" id="temario-input" accept=".csv" style="display:none;" onchange="app._handleTemarioImport(event)" />
                    </div>
                </div>

                <div class="perfil-section">
                    <div class="section-title">🔗 Sincronización en la Nube (GitHub)</div>
                    <div class="perfil-card" style="padding:16px;">
                        <p style="font-size:13px;color:var(--outline);margin-bottom:12px;">
                            Los cambios se sincronizan automáticamente. Sube un CSV y se actualizará GitHub.
                        </p>
                        <input type="text" id="gist-id" placeholder="Gist ID" 
                               value="${store.settings.githubGistId || ''}"
                               style="width:100%;padding:8px;margin-bottom:8px;border-radius:8px;border:1px solid var(--outline-opacity);background:var(--bg-secondary);color:var(--on-surface);">
                        <input type="password" id="github-token" placeholder="GitHub Token (ghp_...)" 
                               value="${store.settings.githubToken || ''}"
                               style="width:100%;padding:8px;margin-bottom:12px;border-radius:8px;border:1px solid var(--outline-opacity);background:var(--bg-secondary);color:var(--on-surface);">
                        <button class="btn btn-primary btn-full" onclick="app._saveGitHubCredentials()">
                            💾 Guardar y Sincronizar
                        </button>
                    </div>
                </div>

                <div class="perfil-section">
                    <div class="section-title">Personalización</div>
                    <div class="perfil-card">
                        <div class="color-section">
                            <div class="label"><span>🎨</span> Color de Acento</div>
                            <div class="color-picker">
                                ${['#007AFF','#FF9500','#34C759','#AF52DE','#FF2D55','#5856D6'].map(c => `
                                    <div class="color-dot ${store.settings.accentColor === c ? 'selected' : ''}"
                                         style="background:${c};"
                                         onclick="app._setAccentColor('${c}')"></div>
                                `).join('')}
                            </div>
                        </div>
                        <div style="height:0.5px;background:var(--card-stroke);margin:12px 0;"></div>
                        <div class="toggle-row" style="padding:0;">
                            <div class="icon-wrap"><span>🌙</span></div>
                            <span class="title">Modo Oscuro</span>
                            <input type="checkbox" class="ios-toggle" ${store.settings.isDarkMode ? 'checked' : ''}
                                   onchange="store.saveSetting('isDarkMode', this.checked);app._applyTheme();" />
                        </div>
                    </div>
                </div>

                <div class="perfil-section">
                    <div class="section-title">Ajustes de la App</div>
                    <div class="perfil-card" style="padding:0;">
                        <div class="toggle-row">
                            <div class="icon-wrap"><span>🔔</span></div>
                            <span class="title">Notificaciones</span>
                            <input type="checkbox" class="ios-toggle" checked />
                        </div>
                        <div class="divider"></div>
                        <div class="toggle-row">
                            <div class="icon-wrap"><span>🌙</span></div>
                            <span class="title">Modo Oscuro</span>
                            <input type="checkbox" class="ios-toggle" ${store.settings.isDarkMode ? 'checked' : ''}
                                   onchange="store.saveSetting('isDarkMode', this.checked);app._applyTheme();" />
                        </div>
                    </div>
                </div>

                <div style="padding:20px;display:flex;flex-direction:column;gap:12px;">
                    <button class="btn btn-ghost btn-full" onclick="app._doGuestLogin()" style="color:var(--accent);">
                        <span>👤</span> Cambiar Nombre
                    </button>
                    <button class="btn btn-full" style="background:rgba(255,59,48,0.1);color:#FF3B30;" onclick="app._doLogout();">
                        <span>🚪</span> Cerrar Sesión
                    </button>
                </div>

                <div style="height:40px;"></div>
            </div>
        `;
    }

    async _handleCSVImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        const text = await file.text();
        const questions = CSVParser.parse(text);

        if (questions.length === 0) {
            alert('No se encontraron preguntas válidas en el archivo.');
            return;
        }

        store._showLoading = true;
        this._showLoading(true);

        const result = await store.importQuestions(questions);
        this._showLoading(false);

        alert(`✅ Se han añadido ${result.added} preguntas nuevas.\n\n${result.skipped > 0 ? `Se han omitido ${result.skipped} preguntas duplicadas.` : ''}`);
        this._renderPerfil();
        this._renderHome();
    }

    async _handleTemarioImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        const text = await file.text();
        const definitions = CSVParser.parseTemarioCSV(text);

        if (definitions.length === 0) {
            alert('No se encontraron definiciones válidas.');
            return;
        }

        await store.bulkAddTemario(definitions);
        alert(`✅ Se han importado ${definitions.length} definiciones.`);
        this._renderPerfil();
        this._renderBiblioteca();
    }

    async _setAccentColor(color) {
        store.settings.accentColor = color;
        await store.saveSetting('accentColor', color);
        this._applyTheme();
        this._renderPerfil();
    }

    async _saveGitHubCredentials() {
        const gistId = document.getElementById('gist-id').value.trim();
        const token = document.getElementById('github-token').value.trim();

        if (!gistId) {
            alert('Introduce el Gist ID');
            return;
        }

        await store.setGitHubCredentials(gistId, token);
        await store.pullFromGitHub();
        alert('✅ Credenciales guardadas. Sincronización completada.');
        this._renderPerfil();
    }

    /* ===== EXAM VIEW ===== */
    _renderExam() {
        const el = document.getElementById('view-exam');
        el.innerHTML = `
            <div class="exam-header" id="exam-header"></div>
            <div class="exam-question-area">
                <div id="exam-question-text" class="exam-question-text"></div>
                <div id="exam-options" class="options-list"></div>
                <div id="exam-explanation" style="margin-top:24px;display:none;"></div>
            </div>
            <div class="exam-footer-area">
                <div class="exam-footer">
                    <button class="btn btn-icon btn-ghost" id="exam-prev" onclick="store.prevQuestion()">
                        <span style="font-size:24px;">‹</span>
                    </button>
                    <button class="btn btn-primary btn-full" id="exam-next" onclick="store.nextQuestion()">
                        Siguiente
                    </button>
                </div>
            </div>
        `;
    }

    _updateExamView() {
        if (store.currentQuestions.length === 0) return;

        const q = store.currentQuestions[store.currentQuestionIndex];
        if (!q) return;

        const header = document.getElementById('exam-header');
        const questionText = document.getElementById('exam-question-text');
        const options = document.getElementById('exam-options');
        const explanation = document.getElementById('exam-explanation');
        const nextBtn = document.getElementById('exam-next');

        if (!header || !questionText || !options) return;

        const isReview = store.currentExamType === 'Repaso de Errores';
        const hasAnswered = store.userAnswers[store.currentQuestionIndex] !== null;
        const isCorrect = hasAnswered && store.userAnswers[store.currentQuestionIndex] === q.correctIndex;

        header.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span onclick="app.confirmExit()" style="font-size:17px;color:var(--accent);cursor:pointer;">‹ Salir</span>
                </div>
                ${store.currentExamType !== 'Repaso de Errores' ? `
                    <div class="timer-badge ${store.timeRemaining < 300 ? 'critical' : ''}" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:12px;background:${store.timeRemaining < 300 ? 'rgba(255,59,48,0.1)' : 'rgba(0,122,255,0.1)'};">
                        <span style="color:${store.timeRemaining < 300 ? '#FF3B30' : 'var(--accent)'};">⏱️</span>
                        <span style="font-size:17px;font-weight:700;color:${store.timeRemaining < 300 ? '#FF3B30' : 'var(--on-surface)'};">${store.formatTime(store.timeRemaining)}</span>
                    </div>
                ` : ''}
                ${store.isSurvivalMode ? `
                    <div style="display:flex;gap:12px;">
                        <span style="font-size:17px;color:#FF9500;font-weight:700;">🔥 ${store.currentQuestionIndex}</span>
                        <span style="font-size:17px;color:#FFD60A;font-weight:700;">🏆 ${store.bestSurvivalStreak}</span>
                    </div>
                ` : ''}
            </div>
            <div class="progress-bar">
                <div class="fill" style="width:${((store.currentQuestionIndex + 1) / store.currentQuestions.length) * 100}%;"></div>
            </div>
            <div style="text-align:right;margin-top:4px;">
                <span style="font-size:12px;font-weight:700;color:var(--outline);color:var(--outline-opacity);">Pregunta ${store.currentQuestionIndex + 1} de ${store.currentQuestions.length}</span>
            </div>
        `;

        questionText.textContent = q.text;

        const letters = ['A', 'B', 'C', 'D'];
        options.innerHTML = q.options.map((opt, i) => {
            let stateClass = '';
            let statusIcon = '';
            if (isReview && hasAnswered) {
                if (i === q.correctIndex) { stateClass = 'correct'; statusIcon = '✅'; }
                else if (i === store.selectedOption) { stateClass = 'incorrect'; statusIcon = '❌'; }
            } else if (i === store.selectedOption) {
                stateClass = 'selected';
                statusIcon = '✅';
            }

            return `
                <div class="option-row ${stateClass}" onclick="store.selectOption(${i}, ${store.currentQuestionIndex})">
                    <div class="letter">${letters[i]}</div>
                    <div class="text">${opt}</div>
                    ${statusIcon ? `<div class="status-icon">${statusIcon}</div>` : ''}
                </div>
            `;
        }).join('');

        if (isReview && hasAnswered && q.explanation) {
            explanation.style.display = 'block';
            explanation.innerHTML = `
                <div class="explanation-box">
                    <div class="header">
                        <span style="color:var(--accent);">ℹ️</span>
                        <span>Explicación</span>
                    </div>
                    <div class="text">${q.explanation}</div>
                </div>
            `;
        } else {
            explanation.style.display = 'none';
        }

        nextBtn.textContent = store.currentQuestionIndex < store.currentQuestions.length - 1 ? 'Siguiente' : 'Finalizar';
    }

    /* ===== RESULTS VIEW ===== */
    _renderResults() {
        const el = document.getElementById('view-results');
        el.innerHTML = `
            <div id="results-content" style="padding:40px 20px;"></div>
        `;
    }

    _updateResultsView() {
        const content = document.getElementById('results-content');
        if (!content || !store.lastExamResult) return;

        const r = store.lastExamResult;

        if (store.isSurvivalMode || r.type === 'Supervivencia') {
            content.innerHTML = `
                <div class="streak-display">
                    <div class="emoji">🔥</div>
                    <div class="count">${r.streak || r.score}</div>
                    <div class="label">ACIERTO${(r.streak || r.score) === 1 ? '' : 'S'}</div>
                </div>
                <div style="margin-top:24px;text-align:center;">
                    <div style="font-size:18px;font-weight:700;color:${r.streak >= store.bestSurvivalStreak ? '#FF9500' : 'var(--on-surface)'};">
                        ${r.streak >= store.bestSurvivalStreak ? '¡NUEVO RÉCORD PERSONAL!' : '¡Sigue intentándolo!'}
                    </div>
                    <div style="font-size:15px;color:var(--outline);color:var(--outline-opacity);margin-top:8px;">
                        Has superado ${r.streak || r.score} preguntas sin fallar.
                    </div>
                </div>
                <div class="results-details" style="margin-top:24px;">
                    <div class="result-row">
                        <span class="title">Mejor Marca</span>
                        <span class="value">${store.bestSurvivalStreak} 🔥</span>
                    </div>
                    <div class="result-row">
                        <span class="title">Última Racha</span>
                        <span class="value">${r.streak || r.score}</span>
                    </div>
                </div>
                <div class="results-actions" style="margin-top:32px;">
                    <button class="btn btn-primary btn-full btn-lg" onclick="store.resetExam();app._showTab(0);">
                        Volver al Inicio
                    </button>
                </div>
            `;
        } else {
            const score = r.score;
            const passMark = 5;
            const isPass = score >= passMark;

            content.innerHTML = `
                <div class="results-header">
                    <div class="score-circle ${isPass ? 'pass' : 'fail'}">
                        <div class="score">${score.toFixed(1)}</div>
                        <div class="status">${isPass ? 'APROBADO' : 'NO APTO'}</div>
                    </div>
                    <div style="margin-top:16px;font-size:17px;font-weight:500;color:var(--outline);color:var(--outline-opacity);text-align:center;">
                        ${isPass ? '¡Enhorabuena, vas por buen camino!' : 'No te rindas, sigue practicando.'}
                    </div>
                </div>
                <div class="results-details">
                    <div class="result-row">
                        <span class="title">Preguntas Totales</span>
                        <span class="value">${r.total}</span>
                    </div>
                    <div class="result-row">
                        <span class="title">Fase del Examen</span>
                        <span class="value">${store.currentExamType}</span>
                    </div>
                    <div class="result-row">
                        <span class="title">Correctas</span>
                        <span class="value" style="color:#34C759;">${r.correct}</span>
                    </div>
                    <div class="result-row">
                        <span class="title">Incorrectas</span>
                        <span class="value" style="color:#FF3B30;">${r.wrong}</span>
                    </div>
                    <div class="result-row">
                        <span class="title">En blanco</span>
                        <span class="value">${r.blank}</span>
                    </div>
                </div>
                <div class="results-actions" style="margin-top:32px;">
                    <button class="btn btn-primary btn-full btn-lg" onclick="store.resetExam();app._showTab(0);">
                        Volver al Inicio
                    </button>
                </div>
            `;
        }
    }

    /* ===== LOADING OVERLAY ===== */
    _renderLoading() {
        const el = document.getElementById('loading-overlay');
        el.innerHTML = `
            <div class="loading-content">
                <div class="loading-spinner"></div>
                <span style="font-size:17px;font-weight:600;">Preparando simulacro...</span>
            </div>
        `;
    }

    /* ===== CONFETTI ===== */
    _launchConfetti() {
        const canvas = document.getElementById('confetti-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const particles = [];
        const colors = ['#007AFF', '#FF9500', '#34C759', '#AF52DE', '#FF2D55', '#FFD60A'];

        for (let i = 0; i < 100; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height - canvas.height,
                w: Math.random() * 8 + 4,
                h: Math.random() * 4 + 2,
                color: colors[Math.floor(Math.random() * colors.length)],
                vy: Math.random() * 3 + 2,
                vx: (Math.random() - 0.5) * 2,
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 10
            });
        }

        let frame = 0;
        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach(p => {
                p.y += p.vy;
                p.x += p.vx;
                p.rotation += p.rotationSpeed;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                ctx.restore();
            });
            frame++;
            if (frame < 180) {
                requestAnimationFrame(animate);
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        };
        animate();
    }
}

const app = new App();
window.app = app;
window._opositestApp = app;

store.onStateChange((s, event) => {
    if (event === 'timerTick') {
        const timerBadge = document.querySelector('.timer-badge span:last-child');
        if (timerBadge) timerBadge.textContent = store.formatTime(store.timeRemaining);
    }

    if (store.currentView === 'exam' || document.getElementById('view-exam')?.classList.contains('active')) {
        app._updateExamView();
    }

    if (document.getElementById('view-results')?.classList.contains('active')) {
        app._updateResultsView();
    }

    app._renderHome();
});

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
