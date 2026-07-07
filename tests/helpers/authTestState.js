const TEST_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "test@beru.app",
};

const TEST_PROFILE = {
  id: TEST_USER.id,
  email: TEST_USER.email,
  full_name: "Test User",
  role: "admin",
  is_active: true,
};

/** Bypass login gate in component tests. */
export async function seedAuthenticatedAuth(overrides = {}) {
  const { default: useEditorStore } = await import("../../src/stores/useEditorStore.js");
  useEditorStore.setState({
    authStatus: "authenticated",
    user: TEST_USER,
    profile: TEST_PROFILE,
    authError: null,
    initAuth: async () => ({ ok: true }),
    ...overrides,
  });
  return useEditorStore;
}

/** @deprecated Use seedAuthenticatedAuth — kept for existing test imports. */
export const seedAuthenticatedAuthSync = seedAuthenticatedAuth;
