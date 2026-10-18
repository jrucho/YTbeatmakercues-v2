const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');

test('mini-bar starts hidden and hiding is purely visual, without changing active audio/loop state', () => {
  const bar = { hidden: false, style: {} };
  const state = { installed: true, mutes: { vocals: true }, ai: { ready: true }, dropdownOpen: true };
  const region = { state: { in: 1, out: 2, enabled: true }, menu: { style: { display: 'block' } } };
  const context = { minimalUIContainer: bar, minimalActive: true, blindMode: false, stemState: state,
    regionLoopController: region, refreshStemsUI() {}, closeStemContextMenu() {}, window: {},
    document: {}, shouldRunOnThisPage: () => false };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const MINIMAL_POS_KEY'),source.indexOf('function createIconButton(')),context);
  context.applyMinimalUIVisibility();
  assert.equal(bar.hidden,true);assert.equal(bar.style.display,'none');
  vm.runInContext('minimalVisible = true',context);context.applyMinimalUIVisibility();
  assert.equal(bar.hidden,false);assert.equal(bar.style.display,'flex');
  context.hideMinimalUIBar();
  assert.equal(bar.hidden,true);assert.equal(state.installed,true);assert.equal(state.mutes.vocals,true);
  assert.equal(state.ai.ready,true);assert.equal(region.state.enabled,true);
  assert.equal(region.menu.style.display,'none');assert.equal(state.dropdownOpen,false);
});

test('startup rendering respects the hidden choice and ordinary show actions explicitly reveal the mini bar', () => {
  const bar={hidden:true,style:{}};
  const context={blindMode:false,minimalActive:true,minimalVisible:false,minimalUIContainer:bar,panelContainer:{style:{}},
    updateMinimalToggleButtonState(){},setupMinimalUIDrag(){},mountMinimalUIContainer(){},window:{},
    applyMinimalUIVisibility(){bar.hidden=!context.minimalVisible;}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function goMinimalUI('),source.indexOf('/**************************************\n * Advanced Panel')),context);
  context.goMinimalUI({show:false});assert.equal(context.minimalVisible,false);assert.equal(bar.hidden,true);
  context.goMinimalUI();assert.equal(context.minimalVisible,true);assert.equal(bar.hidden,false);
});
