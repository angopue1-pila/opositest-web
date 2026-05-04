class Store {
    constructor() {
        this.questions = [];
        this.temario = [];
        this.examHistory = [];
        this.settings = {
            userName: '',
            accentColor: '#007AFF',
            isDarkMode: false,
            isOnboardingCompleted: false,
            notificationsEnabled: true
        };
        this.masteredQuestions = new Set();
        this.failedQuestions = new Set();

        this.currentExamType = '';
        this.currentQuestions = [];
        this.userAnswers = [];
        this.selectedOption = null;
        this.currentQuestionIndex = 0;
        this.timeRemaining = 0;
        this.timer = null;
        this.isSurvivalMode = false;
        this.survivalStreak = 0;
        this.lastSurvivalStreak = 0;
        this.lastExamResult = null;
        this.isGenerating = false;
        this.navigateToExam = false;
        this.navigateToResults = false;
        this.currentView = 'home';
        this.reviewEmptyMessage = null;
    }

    async loadSettings() {
        try {
            const saved = await db.getAll('settings');
            saved.forEach(item => {
                if (this.settings.hasOwnProperty(item.key)) {
                    this.settings[item.key] = item.value;
                }
            });
            const mastered = await db.getAll('mastered');
            this.masteredQuestions = new Set(mastered.map(m => m.questionText));
            const failed = await db.getAll('failed');
            this.failedQuestions = new Set(failed.map(f => f.questionText));
        } catch (e) {
            console.log('No saved settings found');
        }
    }

    async saveSetting(key, value) {
        this.settings[key] = value;
        await db.put('settings', { key, value });
    }

    async loadQuestions() {
        this.questions = await db.getAll('questions');
    }

    async loadTemario() {
        this.temario = await db.getAll('temario');
    }

    async loadExamHistory() {
        this.examHistory = await db.getAll('examHistory');
    }

    async saveExamResult(result) {
        this.examHistory.push(result);
        await db.add('examHistory', {
            ...result,
            date: new Date().toISOString()
        });
    }

    async addTemario(item) {
        await db.add('temario', item);
        this.temario.push(item);
    }

    async bulkAddTemario(items) {
        await db.bulkAdd('temario', items);
        this.temario = await db.getAll('temario');
    }

    get availableThemes() {
        const canonicalCategories = [
            'Actividad Comercial',
            'II Plan de Igualdad',
            'Cultura de Seguridad',
            'Experiencia de Cliente',
            'Conocimientos Ferroviarios'
        ];
        const categoryMap = {};
        const icons = {
            'Actividad Comercial': ['bag.fill', '#007AFF'],
            'II Plan de Igualdad': ['person.2.fill', '#AF52DE'],
            'Cultura de Seguridad': ['shield.fill', '#FF3B30'],
            'Experiencia de Cliente': ['star.fill', '#FF9500'],
            'Conocimientos Ferroviarios': ['train.side.front.car', '#34C759']
        };

        this.questions.forEach(q => {
            const cat = q.category || 'General';
            if (!canonicalCategories.includes(cat)) return;
            if (!categoryMap[cat]) {
                categoryMap[cat] = 0;
            }
            categoryMap[cat]++;
        });

        return canonicalCategories
            .filter(name => categoryMap[name] > 0)
            .map(name => {
                const [icon, color] = icons[name] || ['questionmark.circle.fill', '#007AFF'];
                return [name, icon, color, categoryMap[name]];
            });
    }

    get totalQuestionCount() {
        return this.questions.length;
    }

    get categoryBreakdown() {
        const canonicalCategories = [
            'Actividad Comercial',
            'II Plan de Igualdad',
            'Cultura de Seguridad',
            'Experiencia de Cliente',
            'Conocimientos Ferroviarios'
        ];
        const counts = {};
        const icons = {
            'Actividad Comercial': ['bag.fill', '#007AFF'],
            'II Plan de Igualdad': ['person.2.fill', '#AF52DE'],
            'Cultura de Seguridad': ['shield.fill', '#FF3B30'],
            'Experiencia de Cliente': ['star.fill', '#FF9500'],
            'Conocimientos Ferroviarios': ['train.side.front.car', '#34C759']
        };

        this.questions.forEach(q => {
            const cat = q.category || 'General';
            if (!canonicalCategories.includes(cat)) return;
            if (!counts[cat]) counts[cat] = 0;
            counts[cat]++;
        });

        return canonicalCategories
            .filter(name => counts[name] > 0)
            .map(name => {
                const [icon, color] = icons[name] || ['questionmark.circle.fill', '#007AFF'];
                return [name, icon, color, counts[name]];
            });
    }

    get averageScore() {
        if (this.examHistory.length === 0) return 0;
        const total = this.examHistory.reduce((sum, h) => sum + (h.score || 0), 0);
        return total / this.examHistory.length;
    }

    get currentStreak() {
        const streak = parseInt(localStorage.getItem('currentStreak') || '0');
        return streak;
    }

    get bestSurvivalStreak() {
        return parseInt(localStorage.getItem('bestSurvivalStreak') || '0');
    }

    set bestSurvivalStreak(value) {
        localStorage.setItem('bestSurvivalStreak', value.toString());
    }

    async updateStreak(value) {
        localStorage.setItem('currentStreak', value.toString());
    }

    loadOfficialExam() {
        this.isGenerating = true;
        const temarioQs = this.questions.filter(q => !q.isPsicotecnico);
        const psicoQs = this.questions.filter(q => q.isPsicotecnico);

        const selectedT = this._shuffle([...temarioQs]).slice(0, 60);
        const selectedP = this._shuffle([...psicoQs]).slice(0, 40);

        this.currentQuestions = this._shuffle([...selectedT, ...selectedP]);
        this.currentExamType = 'Simulacro Oficial';
        this.isSurvivalMode = false;
        this.userAnswers = new Array(this.currentQuestions.length).fill(null);
        this.selectedOption = null;
        this.timeRemaining = 55 * 60;

        setTimeout(() => {
            this.isGenerating = false;
            this.navigateToExam = true;
            this.startTimer();
            this._emit('stateChange');
        }, 500);
        this._emit('stateChange');
    }

    loadExamByCategory(category) {
        const categoryQuestions = this.questions.filter(q =>
            q.category === category && !q.isPsicotecnico
        );

        if (categoryQuestions.length === 0) {
            this.reviewEmptyMessage = `No hay preguntas de la categoría "${category}". Importa más preguntas desde el Perfil.`;
            this._emit('stateChange');
            return;
        }

        const count = Math.min(20, categoryQuestions.length);
        this.currentQuestions = this._shuffle([...categoryQuestions]).slice(0, count);
        this.currentExamType = category;
        this.isSurvivalMode = false;
        this.userAnswers = new Array(this.currentQuestions.length).fill(null);
        this.selectedOption = null;
        this.timeRemaining = 20 * 60; // 20 minutes for 20 questions

        this.navigateToExam = true;
        this.startTimer();
        this._emit('stateChange');
    }

    loadPsicotecnico(tipo) {
        const psicoQuestions = this.questions.filter(q =>
            q.isPsicotecnico && q.psicotecnicoType === tipo
        );

        if (psicoQuestions.length === 0) {
            this.reviewEmptyMessage = `No hay preguntas de "${tipo}". Importa más preguntas psicotécnicas.`;
            this._emit('stateChange');
            return;
        }

        const count = Math.min(20, psicoQuestions.length);
        this.currentQuestions = this._shuffle([...psicoQuestions]).slice(0, count);
        this.currentExamType = `Psicotécnico: ${tipo}`;
        this.isSurvivalMode = false;
        this.userAnswers = new Array(this.currentQuestions.length).fill(null);
        this.selectedOption = null;
        this.timeRemaining = count * 90;

        this.navigateToExam = true;
        this.startTimer();
        this._emit('stateChange');
    }

    async loadErrorReviewExam() {
        const failedTexts = [...this.failedQuestions];
        if (failedTexts.length === 0) {
            this.reviewEmptyMessage = '¡No tienes errores pendientes! Has respondido todo correctamente.';
            this._emit('stateChange');
            return;
        }

        const reviewQuestions = this.questions.filter(q =>
            failedTexts.includes(q.text)
        );

        if (reviewQuestions.length === 0) {
            this.reviewEmptyMessage = 'No se encontraron las preguntas falladas en el banco.';
            this._emit('stateChange');
            return;
        }

        this.currentQuestions = this._shuffle([...reviewQuestions]);
        this.currentExamType = 'Repaso de Errores';
        this.isSurvivalMode = false;
        this.userAnswers = new Array(this.currentQuestions.length).fill(null);
        this.selectedOption = null;
        this.timeRemaining = 0;

        this.navigateToExam = true;
        this._emit('stateChange');
    }

    startSurvivalMode() {
        const temarioQs = this.questions.filter(q => !q.isPsicotecnico);
        const psicoQs = this.questions.filter(q => q.isPsicotecnico);

        const tCount = Math.floor(this.questions.length * 0.8);
        const pCount = this.questions.length - tCount;

        const selected = [
            ...this._shuffle([...temarioQs]).slice(0, tCount),
            ...this._shuffle([...psicoQs]).slice(0, pCount)
        ];

        this.currentQuestions = this._shuffle(selected);
        this.currentExamType = 'Supervivencia';
        this.isSurvivalMode = true;
        this.survivalStreak = 0;
        this.userAnswers = new Array(this.currentQuestions.length).fill(null);
        this.selectedOption = null;
        this.timeRemaining = 30;

        this.navigateToExam = true;
        this.startTimer();
        this._emit('stateChange');
    }

    selectOption(index, questionIndex) {
        if (this.userAnswers[questionIndex] !== null) return;

        this.userAnswers[questionIndex] = index;
        this.selectedOption = index;

        if (this.isSurvivalMode) {
            const correct = this.currentQuestions[questionIndex].correctIndex;
            if (index === correct) {
                this.survivalStreak++;
                if (this.survivalStreak > this.bestSurvivalStreak) {
                    this.bestSurvivalStreak = this.survivalStreak;
                    this.saveSetting('bestSurvivalStreak', this.bestSurvivalStreak);
                }
            } else {
                this.lastSurvivalStreak = this.survivalStreak;
                this._markFailed(questionIndex);
                setTimeout(() => this.finishExam(), 800);
            }
        } else {
            if (this.currentExamType === 'Repaso de Errores') {
                const correct = this.currentQuestions[questionIndex].correctIndex;
                if (index === correct) {
                    this._removeFromFailed(questionIndex);
                    this._masterQuestion(questionIndex);
                } else {
                    this._markFailed(questionIndex);
                    this._unmasterQuestion(questionIndex);
                }
            }
        }

        this._emit('stateChange');
    }

    nextQuestion() {
        if (this.currentQuestionIndex < this.currentQuestions.length - 1) {
            this.currentQuestionIndex++;
            this.selectedOption = this.userAnswers[this.currentQuestionIndex];
            if (this.isSurvivalMode) {
                this.resetSurvivalTimer();
                this.startTimer();
            }
            this._emit('stateChange');
        } else {
            this.finishExam();
        }
    }

    prevQuestion() {
        if (this.currentQuestionIndex > 0) {
            this.currentQuestionIndex--;
            this.selectedOption = this.userAnswers[this.currentQuestionIndex];
            this._emit('stateChange');
        }
    }

    finishExam() {
        this.stopTimer();

        if (this.isSurvivalMode) {
            const answeredCount = this.survivalStreak + 1;
            const correct = this.survivalStreak;
            const wrong = 1;
            const total = answeredCount;
            const score = ((correct - wrong * 0.25) / total) * 10;

            const answers = [];
            for (let i = 0; i < answeredCount; i++) {
                const q = this.currentQuestions[i];
                const userAnswer = this.userAnswers[i];
                answers.push({
                    question: q.text,
                    options: q.options,
                    userAnswer: userAnswer,
                    correctAnswer: q.correctIndex,
                    isCorrect: userAnswer === q.correctIndex,
                    category: q.category
                });
            }

            const result = {
                type: 'Supervivencia',
                score: Math.max(0, score),
                correct,
                wrong,
                blank: 0,
                total,
                date: new Date().toISOString(),
                answers,
                survivalStreak: this.survivalStreak
            };

            if (this.lastSurvivalStreak === 0) {
                this.lastSurvivalStreak = this.survivalStreak;
            }
            if (this.survivalStreak > this.bestSurvivalStreak) {
                this.bestSurvivalStreak = this.survivalStreak;
                localStorage.setItem('bestSurvivalStreak', this.survivalStreak.toString());
            }
            this.lastExamResult = result;
            this.saveExamResult(result);
        } else {
            const result = this._calculateScore();
            this.lastExamResult = result;
            this.saveExamResult(result);
        }

        this.updateStreak(this.lastExamResult.score >= 5 ? this.currentStreak + 1 : 0);
        this.navigateToResults = true;
        this._emit('stateChange');
    }

    resetExam() {
        this.stopTimer();
        this.currentQuestions = [];
        this.userAnswers = [];
        this.selectedOption = null;
        this.currentQuestionIndex = 0;
        this.currentExamType = '';
        this.isSurvivalMode = false;
        this.survivalStreak = 0;
        this.navigateToExam = false;
        this.navigateToResults = false;
        this.isGenerating = false;
        this._emit('stateChange');
    }

    startTimer() {
        this.stopTimer();
        this.timer = setInterval(() => {
            if (this.timeRemaining > 0 && this.selectedOption === null) {
                this.timeRemaining--;
                if (this.timeRemaining <= 0) {
                    this.finishExam();
                }
                this._emit('timerTick');
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    resetSurvivalTimer() {
        this.timeRemaining = 30;
    }

    formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    async completeOnboarding(name) {
        this.settings.userName = name;
        this.settings.isOnboardingCompleted = true;
        await this.saveSetting('userName', name);
        await this.saveSetting('isOnboardingCompleted', true);
        this._emit('stateChange');
    }

    async logout() {
        this.settings.userName = '';
        this.settings.isOnboardingCompleted = false;
        await this.saveSetting('userName', '');
        await this.saveSetting('isOnboardingCompleted', false);
        this._emit('stateChange');
    }

    async setGitHubCredentials(gistId, token) {
        await this.saveSetting('githubGistId', gistId);
        await this.saveSetting('githubToken', token);
    }

    async pushToGitHub() {
        const gistId = this.settings.githubGistId;
        const token = this.settings.githubToken;
        if (!gistId || !token) return;

        const questions = await db.getAll('questions');
        try {
            await fetch(`https://api.github.com/gists/${gistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `token ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json'
                },
                body: JSON.stringify({
                    files: {
                        'questions.json': {
                            content: JSON.stringify(questions, null, 2)
                        }
                    }
                })
            });
        } catch (e) {
            console.log('Error pushing to GitHub:', e);
        }
    }

    async pullFromGitHub() {
        const gistId = this.settings.githubGistId;
        if (!gistId) return;

        try {
            const response = await fetch(`https://api.github.com/gists/${gistId}`);
            const gist = await response.json();
            const content = gist.files['questions.json'].content;
            const cloudQuestions = JSON.parse(content);
            await this.importQuestions(cloudQuestions);
        } catch (e) {
            console.log('Error pulling from GitHub:', e);
        }
    }

    async importQuestions(parsedQuestions) {
        const batchId = Date.now();
        let added = 0;
        let updated = 0;
        let skipped = 0;

        for (const q of parsedQuestions) {
            const existing = this.questions.find(eq => eq.text === q.text);
            if (existing) {
                // UPDATE existing question with new data
                existing.options = q.options;
                existing.correctIndex = q.correctIndex;
                existing.explanation = q.explanation;
                existing.category = q.category;
                existing.isPsicotecnico = q.isPsicotecnico;
                existing.psicotecnicoType = q.psicotecnicoType;
                await db.put('questions', existing);
                updated++;
            } else {
                q.isImported = true;
                q.importBatch = batchId;
                await db.add('questions', q);
                added++;
            }
        }

        await this.loadQuestions();
        this.pushToGitHub();
        return { added, updated, skipped };
    }

    async removeLastImportedBatch() {
        let maxBatch = 0;
        this.questions.forEach(q => {
            if (q.importBatch && q.importBatch > maxBatch) {
                maxBatch = q.importBatch;
            }
        });

        if (maxBatch === 0) return 0;

        const toRemove = this.questions.filter(q => q.importBatch === maxBatch);
        for (const q of toRemove) {
            await db.delete('questions', q.id);
        }

        await this.loadQuestions();
        return toRemove.length;
    }

    _calculateScore() {
        let correct = 0;
        let wrong = 0;
        let blank = 0;
        const answers = [];

        this.currentQuestions.forEach((q, i) => {
            const userAnswer = this.userAnswers[i];
            if (userAnswer === null) {
                blank++;
            } else if (userAnswer === q.correctIndex) {
                correct++;
            } else {
                wrong++;
            }
            answers.push({
                question: q.text,
                options: q.options,
                userAnswer: userAnswer,
                correctAnswer: q.correctIndex,
                isCorrect: userAnswer === q.correctIndex,
                category: q.category
            });
        });

        const total = this.currentQuestions.length;
        const score = ((correct - (wrong * 0.25)) / total) * 10;

        return {
            type: this.currentExamType,
            score: Math.max(0, score),
            correct,
            wrong,
            blank,
            total,
            date: new Date().toISOString(),
            answers
        };
    }

    _markFailed(questionIndex) {
        const q = this.currentQuestions[questionIndex];
        if (q && q.text) {
            this.failedQuestions.add(q.text);
            db.put('failed', { questionText: q.text }).catch(() => {});
        }
    }

    _removeFromFailed(questionIndex) {
        const q = this.currentQuestions[questionIndex];
        if (q && q.text) {
            this.failedQuestions.delete(q.text);
            db.delete('failed', q.text).catch(() => {});
        }
    }

    _masterQuestion(questionIndex) {
        const q = this.currentQuestions[questionIndex];
        if (q && q.text) {
            this.masteredQuestions.add(q.text);
            db.put('mastered', { questionText: q.text }).catch(() => {});
        }
    }

    _unmasterQuestion(questionIndex) {
        const q = this.currentQuestions[questionIndex];
        if (q && q.text) {
            this.masteredQuestions.delete(q.text);
            db.delete('mastered', q.text).catch(() => {});
        }
    }

    _shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    _listeners = [];
    onStateChange(callback) {
        this._listeners.push(callback);
    }
    _emit(event) {
        this._listeners.forEach(cb => cb(this, event));
    }
}

const store = new Store();
window.store = store;
