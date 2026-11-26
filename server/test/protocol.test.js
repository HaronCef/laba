import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOSE, validate } from '../src/protocol.js';

test('правильні повідомлення проходять', () => {
  assert.equal(validate('{"v":0,"type":"join","room":"belt","name":"Kyrylo"}').ok, true);
  assert.equal(validate('{"v":0,"type":"chat","text":"привіт"}').ok, true);
  assert.equal(validate('{"v":0,"type":"leave"}').ok, true);
});

test('зламані повідомлення отримують свій код', () => {
  assert.equal(validate('не json').code, CLOSE.BAD_MESSAGE);
  assert.equal(validate('[1,2]').code, CLOSE.BAD_MESSAGE);
  assert.equal(validate('{"v":1,"type":"chat","text":"x"}').code, CLOSE.BAD_VERSION);
  assert.equal(validate('{"v":0,"type":"fly"}').code, CLOSE.UNKNOWN_TYPE);
  assert.equal(validate('{"v":0,"type":"constructor"}').code, CLOSE.UNKNOWN_TYPE);
  assert.equal(validate('{"v":0,"type":"chat","text":""}').code, CLOSE.BAD_MESSAGE);
  assert.equal(
    validate(`{"v":0,"type":"chat","text":"${'a'.repeat(201)}"}`).code,
    CLOSE.BAD_MESSAGE,
  );
  assert.equal(
    validate('{"v":0,"type":"join","room":"../x","name":"a"}').code,
    CLOSE.BAD_MESSAGE,
  );
});
