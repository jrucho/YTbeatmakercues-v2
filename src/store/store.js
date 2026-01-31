const shallowEqual = (a, b) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || !Object.is(a[key], b[key])) {
      return false;
    }
  }
  return true;
};

export function createStore(reducer, initialState) {
  let state = initialState;
  const subscribers = new Set();

  const getState = () => state;

  const dispatch = (action) => {
    state = reducer(state, action);
    subscribers.forEach((sub) => {
      const nextSlice = sub.selector(state);
      if (!shallowEqual(nextSlice, sub.prevSlice)) {
        const prev = sub.prevSlice;
        sub.prevSlice = nextSlice;
        sub.callback(nextSlice, prev);
      }
    });
  };

  const subscribe = (selector, callback) => {
    const entry = {
      selector,
      callback,
      prevSlice: selector(state)
    };
    subscribers.add(entry);
    return () => subscribers.delete(entry);
  };

  return { getState, dispatch, subscribe };
}
