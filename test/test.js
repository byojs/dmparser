const Dmparser = require('../dmparser');
const SimpleFileAccessor = require('../SimpleFileAccessor');
const TestUtil = require('../TestUtil');
const TokenSerializer = require('../TokenSerializer');

const assert = require('assert');

describe('basics', function() {
    it('should correctly lex this file', async function() {
        const tokens = await new Dmparser(new SimpleFileAccessor()).lexUnit('Your First World/Your First World.dme');
        assert.deepEqual(TokenSerializer.serializeList(tokens),
                await TestUtil.loadJsonFromFile('test/Your First World.lex.json'));
    })

    it('should correctly lex this file', async function() {
        const tokens = await new Dmparser(new SimpleFileAccessor()).lexUnit('Your First World/main-b.dm');
        assert.deepEqual(TokenSerializer.serializeList(tokens),
                await TestUtil.loadJsonFromFile('test/main-b.lex.json'));
    })

    it('should correctly lex this file', async function() {
        const tokens = await new Dmparser(new SimpleFileAccessor()).lexUnit('Your First World/main-c.dm');
        assert.deepEqual(TokenSerializer.serializeList(tokens),
                await TestUtil.loadJsonFromFile('test/main-c.lex.json'));
    })

    it('should correctly lex this file', async function() {
        const tokens = await new Dmparser(new SimpleFileAccessor()).lexUnit('Your First World/main-d.dm');
        assert.deepEqual(TokenSerializer.serializeList(tokens),
                await TestUtil.loadJsonFromFile('test/main-d.lex.json'));
    })

    it('should correctly lex this file', async function() {
        const tokens = await new Dmparser(new SimpleFileAccessor()).lexUnit('Your First World/main-e.dm');
        //TestUtil.dumpJson('test/main-e.lex.json', TokenSerializer.serializeList(tokens), true);
        assert.deepEqual(TokenSerializer.serializeList(tokens),
                await TestUtil.loadJsonFromFile('test/main-e.lex.json'));
    })

    it('should report correct location for diagnostics in included file', async function() {
        try {
            const promise = new Dmparser(new SimpleFileAccessor()).lexUnit('test/correct-diagnostic-include/a.dm');
            await promise;
            assert.fail();
        }
        catch (err) {
            assert.equal(err.message, 'Parse error at test/correct-diagnostic-include/b.dm:2:1: Unexpected character')
        }
    })

    it('preprocessor should report correct line for diagnostic', async function() {
        try {
            const promise = new Dmparser(new SimpleFileAccessor()).lexUnit('test/_compile_options.dm');
            await promise;
            assert.fail();
        }
        catch (err) {
            assert.equal(err.message, '(cpp) error # test/_compile_options.dm:76: #error: Your version of BYOND is too out-of-date to compile this project. Go to byond.com/download and update.')
        }
    })
})
