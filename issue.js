const { JSDOM } = require('jsdom');

const dom = new JSDOM();

const document = dom.window.document;
const styleDoc = document.implementation.createHTMLDocument('');
const styleElem = document.createElement('style');
styleElem.textContent = `.test { color: red; }`;
styleDoc.body.appendChild(styleElem);

console.log(styleElem.sheet); // null
