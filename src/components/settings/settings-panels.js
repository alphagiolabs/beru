import { lazyPanel } from "../../utils/lazy-panel";

export const PetdexPanel = lazyPanel(() => import("../../features/pets/settings/PetdexPanel.jsx"));
export const UserManagementPanel = lazyPanel(() => import("./UserManagementPanel"));
export const AppearancePanel = lazyPanel(() => import("./AppearancePanel"));
