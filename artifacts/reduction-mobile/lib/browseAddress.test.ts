import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_ENGINE, addressFor, pageIdentity, searchUrl, searchWordsOf } from './browseAddress';

test('a web address loads; a bare domain gains https://', () => {
  assert.equal(addressFor('https://www.allrecipes.com/recipe/1/'), 'https://www.allrecipes.com/recipe/1/');
  assert.equal(addressFor('  http://example.com  '), 'http://example.com');
  assert.equal(addressFor('allrecipes.com'), 'https://allrecipes.com');
  assert.equal(addressFor('www.bbcgoodfood.com/recipes/easy-pancakes'), 'https://www.bbcgoodfood.com/recipes/easy-pancakes');
  assert.equal(addressFor('food52.com:443/recipes?x=1'), 'https://food52.com:443/recipes?x=1');
});

test('anything else is a search, on the one engine', () => {
  assert.equal(SEARCH_ENGINE.name, 'DuckDuckGo');
  for (const words of ['banana bread', 'lasagna', '3.5 cups flour', 'best brownies.', 'mum\'s.pie recipe', 'https://', 'nyt cooking lasagna']) {
    const got = addressFor(words);
    assert.ok(got?.startsWith(SEARCH_ENGINE.url), `${words} → ${got}`);
    assert.equal(searchWordsOf(got!), words.trim());
  }
  assert.equal(searchUrl(' chili & cornbread '), `${SEARCH_ENGINE.url}chili%20%26%20cornbread`);
  assert.equal(addressFor('   '), null);
});

test('the address bar shows the words of a search, and nothing for a page', () => {
  assert.equal(searchWordsOf(searchUrl('sunday gravy')), 'sunday gravy');
  assert.equal(searchWordsOf('https://www.allrecipes.com/'), null);
});

test('one page however its address was spelled', () => {
  const same = ['https://www.example.com/pie/', 'http://example.com/pie', 'https://EXAMPLE.com/Pie#comments', 'https://example.com/pie?utm_source=x'];
  for (const u of same) assert.equal(pageIdentity(u), 'example.com/pie', u);
  assert.notEqual(pageIdentity('https://example.com/pie-2'), pageIdentity('https://example.com/pie'));
  assert.equal(pageIdentity(null), null);
  assert.equal(pageIdentity('not a url'), null);
});
