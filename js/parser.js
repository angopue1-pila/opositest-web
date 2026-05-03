class CSVParser {
    static categoryAliases = {
        'actividad comercial': 'Actividad Comercial',
        'actividades comerciales': 'Actividad Comercial',
        'comercial': 'Actividad Comercial',
        'ii plan de igualdad': 'II Plan de Igualdad',
        'plan de igualdad': 'II Plan de Igualdad',
        'igualdad': 'II Plan de Igualdad',
        'cultura de seguridad': 'Cultura de Seguridad',
        'seguridad': 'Cultura de Seguridad',
        'experiencia de cliente': 'Experiencia de Cliente',
        'atencion al cliente': 'Experiencia de Cliente',
        'cliente': 'Experiencia de Cliente',
        'conocimientos ferroviarios': 'Conocimientos Ferroviarios',
        'ferroviarios': 'Conocimientos Ferroviarios',
        'ferrocarril': 'Conocimientos Ferroviarios',
        'renfe': 'Conocimientos Ferroviarios',
        'psicotecnico': 'Psicotécnico',
        'psicotécnico': 'Psicotécnico',
        'psicotecnicos': 'Psicotécnico',
        'psicotécnicos': 'Psicotécnico'
    };

    static normalizeCategory(cat) {
        if (!cat) return 'General';
        const normalized = cat.trim().toLowerCase();
        return CSVParser.categoryAliases[normalized] || cat.trim();
    }

    static parse(text) {
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        const questions = [];
        let isFirstLine = true;

        for (const line of lines) {
            if (isFirstLine) {
                const firstLine = line.trim().toLowerCase();
                if (firstLine.includes('tema') || firstLine.includes('categor') ||
                    firstLine.includes('pregunta') || firstLine.includes('opcion') ||
                    firstLine.includes('correct') || firstLine.includes('explicacion') ||
                    firstLine.startsWith('category') || firstLine.startsWith('question')) {
                    isFirstLine = false;
                    continue;
                }
                isFirstLine = false;
            }

            const parsed = CSVParser.parseCSVLine(line);
            if (parsed.length >= 7) {
                const question = {
                    category: CSVParser.normalizeCategory(parsed[0]),
                    text: parsed[1].trim(),
                    options: [
                        parsed[2].trim(),
                        parsed[3].trim(),
                        parsed[4].trim(),
                        parsed[5].trim()
                    ].filter(opt => opt.length > 0),
                    correctIndex: parseInt(parsed[6]) || 0,
                    explanation: parsed[7] ? parsed[7].trim() : ''
                };

                const cat = question.category.toLowerCase();
                question.isPsicotecnico = cat.includes('psicotecnico') || cat.includes('psicotécnico');
                question.psicotecnicoType = question.isPsicotecnico ? this._detectPsicoType(question.text) : '';

                if (question.options.length >= 2) {
                    questions.push(question);
                }
            }
        }

        return questions;
    }

    static parseTemarioCSV(text) {
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        const definitions = [];
        let isFirstLine = true;

        for (const line of lines) {
            if (isFirstLine) {
                const firstLine = line.trim().toLowerCase();
                if (firstLine.includes('term') || firstLine.includes('termino') ||
                    firstLine.includes('definicion') || firstLine.includes('category') ||
                    firstLine.includes('categor') || firstLine.includes('descripcion')) {
                    isFirstLine = false;
                    continue;
                }
                isFirstLine = false;
            }

            const parsed = CSVParser.parseCSVLine(line);
            if (parsed.length >= 2) {
                definitions.push({
                    term: parsed[0].trim(),
                    description: parsed[1].trim(),
                    category: parsed[2] ? CSVParser.normalizeCategory(parsed[2]) : 'General'
                });
            }
        }

        return definitions;
    }

    static parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if ((char === ',' || char === ';') && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }

        result.push(current);
        return result;
    }

    static _detectPsicoType(text) {
        const lower = text.toLowerCase();
        if (lower.includes('serie') || lower.includes('siguiente')) return 'De Serie';
        if (lower.includes('figura') || lower.includes('imagen') || lower.includes('dibujo')) return 'Figuras';
        if (lower.includes('númer') || lower.includes('calcul') || lower.includes('matemát')) return 'Numérico';
        if (lower.includes('sinónim') || lower.includes('antónim') || lower.includes('palabra')) return 'Verbal';
        if (lower.includes('atención') || lower.includes('observ') || lower.includes('detalle')) return 'Atención';
        if (lower.includes('memoriz') || lower.includes('record') || lower.includes('memoria')) return 'Memoria';
        if (lower.includes('razon') || lower.includes('lógic') || lower.includes('deducir')) return 'Razonamiento Lógico';
        if (lower.includes('espacial') || lower.includes('dirección') || lower.includes('posición')) return 'Organización Espacial';
        return '';
    }
}
