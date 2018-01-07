const Token = require('./Token');

class SourcePoint {
    constructor(unit, line, column) {
        this.unit = unit;
        this.line = line;
        this.column = column;
    }

    toString() {
        return this.unit + ':' + this.line + ':' + this.column;
    }
}

// --------------------------------------------------------------------------

function isident(c) {
    return /^[a-zA-Z0-9_]$/.test(c);
}

class Lexer {
    constructor(unitName, source, diagnosticsSink) {
        this.unitName = unitName;
        this.source = source;
        this.diag = diagnosticsSink;

        // Sometimes we need to emit more than one token at a time
        this.tokenBacklog = [];

        this.pos = 0;
        this.end = this.source.length;

        this.point = new SourcePoint(unitName, 1, 0);
        this.nextPoint = new SourcePoint(unitName, 1, 1);

        // indent counts number of leading spaces
        // it is cleared to null after a token is parsed
        // it is reset to 0 on new line

        // Whenever a token is emitted and current indent is non-null (every first token on a line), indent is compared
        // to lastIndent, BLOCK_BEGIN/END is emitted and lastIndent is updated
        this.indent = 0;
        this.lastIndent = 0;
    }

    consumePreprocessorDirectives() {
        // A bit hacky, just like the C preprocessor itself
        while (this.nextPoint.column === 1 && this.source[this.pos] === '#') {
            let lineEndIndex = this.source.indexOf('\n', this.pos + 1);

            if (lineEndIndex === -1)
                lineEndIndex = this.source.length;

            const directive = this.source.slice(this.pos, lineEndIndex);
            //console.log(directive);

            // per https://gcc.gnu.org/onlinedocs/cpp/Preprocessor-Output.html
            const linemarker_re = /# (\d+) "([^"]+)" (\d+)/i;
            const [full, line, unit, flags] = directive.match(linemarker_re);
            //console.log([full, line, unit, flags]);

            this.pos = lineEndIndex + 1;
            this.nextPoint = new SourcePoint(
                unit,
                parseInt(line),
                1);
        }
    }

    emitToken(type, span, value) {
        const emissions = [];

        if (type === Token.TOKEN_NEWLINE) {
            // Newline is a special snowflake. It never begins/ends a block on its own, its span is set to null
            // (at least for now), and it resets indent to zero.

            // Handling it here is a bit dirty, but causes the least code ugliness.

            // TODO: option to omit repeated TOKEN_NEWLINE
            // As long as its span is always set to null, it shouldn't make a functional difference
            // However, it would need changes in how readToken works (always use FIFO), which might be a good idea anyways.

            return new Token(type, value, span);
        }

        if (this.indent !== null) {
            while (this.indent > this.lastIndent) {
                emissions.push(new Token(Token.TOKEN_BLOCK_BEGIN));         // TODO: do we care about span?
                this.lastIndent++;
            }

            while (this.indent < this.lastIndent) {
                emissions.push(new Token(Token.TOKEN_BLOCK_END));           // TODO: do we care about span?
                this.lastIndent--;
            }
        }

        const token = new Token(type, value, span);
        emissions.push(token);

        //console.log(token.type, token.span);
        //console.log('(indent', token.this.indent, ')', token.value);

        this.indent = null;

        // This cryptic line takes all emissions past the first one and add them to the backlog
        // TODO: this is idiotic. Why bother special-casing the first one and not just push all through a FIFO?
        this.tokenBacklog.push.apply(this.tokenBacklog, emissions.splice(1));

        return emissions[0];
    }

    parseError(what, point) {
        if (!point)
            point = this.point;

        this.diag.error(what, point);
        throw new Error(what);
    }

    read() {
        this.point = this.nextPoint;

        if (this.source[this.pos] === '\n') {
            this.nextPoint = new SourcePoint(
                    this.nextPoint.unit,
                    this.nextPoint.line + 1,
                    1);
        }
        else {
            this.nextPoint = new SourcePoint(
                    this.nextPoint.unit,
                    this.nextPoint.line,
                    this.nextPoint.column + (this.source[this.pos] === '\t' ? 8 : 1));
        }

        return this.source[this.pos++];
    }

    // TODO: just drop this in favor of readSequence
    readChar(what) {
        if (this.pos < this.end && this.source[this.pos] === what) {
            this.read();
            return true;
        }
        else
            return false;
    }

    // TODO: rename to `match`
    readSequence(what) {
        if (this.pos + what.length <= this.end
                && this.source.slice(this.pos, this.pos + what.length) === what) {
            for (let i = 0; i < what.length; i++)
                this.read();

            return true;
        }
        else
            return false;
    }

    readToken() {
        if (this.tokenBacklog.length > 0)
            return this.tokenBacklog.splice(0, 1)[0];
        else
            return this.doParseToken();
    }

    doParseToken() {
        this.consumePreprocessorDirectives();

        while (this.pos < this.end) {
            const start = this.nextPoint;

            if (this.readChar('\n')) {
                this.indent = 0;        // clearing indent before the emission is somewhat dirty. Any better idea?
                return this.emitToken(Token.TOKEN_NEWLINE);      // TODO: do we care about span?
            }
            else if (this.readSequence('/*')) {
                let comment = '';
                let depth = 1;

                while (this.pos < this.end) {
                    if (this.readSequence('/*')) {
                        depth++;
                    }
                    else if (this.readSequence('*/')) {
                        if (--depth === 0)
                            break;
                    }

                    comment += this.read();
                }

                // FIXME: check for EOF

                return this.emitToken(Token.TOKEN_COMMENT, [start, this.point], comment);
            }
            else if (this.readSequence('//')) {
                let comment = '';

                while (this.pos < this.end && this.source[this.pos] !== '\n') {
                    comment += this.read();
                }

                return this.emitToken(Token.TOKEN_COMMENT, [start, this.point], comment);
            }
            else if (this.readChar(' ')) {
                if (this.indent !== null)
                    this.parseError('Spaces are currently not allowed for indentation. Please use tabs.')
            }
            else if (this.readChar('\t')) {
                if (this.indent !== null)
                    this.indent++;
            }
            else if (!this.readChar('\r'))
                break;
        }

        if (this.pos >= this.end)
            return null;

        const start = this.nextPoint;

        // String literal
        if (this.readChar('"')) {
            let literal = '';
            let wasEscape = false;

            for (;;) {
                if (this.pos >= this.end) {
                    this.parseError("Reached end of input while parsing a string literal");
                }

                let wasEscapeNew = false;

                if (this.source[this.pos] === '"' && !wasEscape) {
                    this.read();
                    break;
                }

                if (this.source[this.pos] === '\\' && !wasEscape)
                    wasEscapeNew = true;
                else if ( wasEscape && this.source[this.pos] === 't' )
                    literal += '\t';
                else if ( wasEscape && this.source[this.pos] === 'n' )
                    literal += '\n';
                else
                    literal += this.source[this.pos];

                wasEscape = wasEscapeNew;
                this.read();
            }

            return this.emitToken(Token.TOKEN_STRING, [start, this.point], literal);
        }
        else if (this.readChar("'")) {
            let literal = '';
            let wasEscape = false;

            for (;;) {
                if (this.pos >= this.end) {
                    this.parseError("Reached end of input while parsing a string literal");
                }

                let wasEscapeNew = false;

                if (this.source[this.pos] === "'" && !wasEscape) {
                    this.read();
                    break;
                }

                if (this.source[this.pos] === '\\' && !wasEscape)
                    wasEscapeNew = true;
                else if ( wasEscape && this.source[this.pos] === 't' )
                    literal += '\t';
                else if ( wasEscape && this.source[this.pos] === 'n' )
                    literal += '\n';
                else
                    literal += this.source[this.pos];

                wasEscape = wasEscapeNew;
                this.read();
            }

            return this.emitToken(Token.TOKEN_STRING2, [start, this.point], literal);
        }

        // Identifier
        if (isident(this.source[this.pos])) {
            let ident = "";

            while (this.pos < this.end && isident(this.source[this.pos])) {
                ident += this.read();
            }

            return this.emitToken(Token.TOKEN_IDENT, [start, this.point], ident);
        }

        // TODO: Map should be used instead
        const literalTokens = {
            TOKEN_BLOCK_BEGIN:  '{',
            TOKEN_BLOCK_END:    '{',
            TOKEN_COMMA:        ',',
            TOKEN_DOT:          '.',
            TOKEN_EQUAL:        '=',
            TOKEN_EXCLAMATION:  '!',
            TOKEN_NEWLINE:      ';',
            TOKEN_PAREN_L:      '(',
            TOKEN_PAREN_R:      ')',
            TOKEN_SHIFT_L:      '<<',
            TOKEN_SLASH:        '/',
        };

        for (const type in literalTokens) {
            if (literalTokens.hasOwnProperty(type)) {
                if (this.readSequence(literalTokens[type]))
                    return this.emitToken(Token[type], [start, this.point]);
            }
        }

        this.parseError('Unexpected character', start);
    }
}

module.exports = Lexer;
