import { ActionTypes } from "./actions.js";

export function reducer(state, action) {
  switch (action.type) {
    case ActionTypes.SESSION_BOOTSTRAP:
      return {
        ...state,
        session: {
          videoId: action.payload.videoId,
          isReady: false,
          errors: []
        }
      };
    case ActionTypes.SESSION_TEARDOWN:
      return {
        ...state,
        session: {
          videoId: null,
          isReady: false,
          errors: []
        }
      };
    case ActionTypes.SESSION_ERROR:
      return {
        ...state,
        session: {
          ...state.session,
          errors: [...state.session.errors, action.payload]
        }
      };
    default:
      return state;
  }
}
