import SidePanel from "./SidePanel";
import ManageAccountPanel from "./ManageAccountPanel";
import { useMobileMenu } from "../context/MobileMenuContext";

const MobileAccountPanel = () => {
  const { isAccountPanelOpen, setIsAccountPanelOpen } = useMobileMenu();

  return (
    <SidePanel
      isOpen={isAccountPanelOpen}
      onClose={() => setIsAccountPanelOpen(false)}
      type="account"
    >
      <ManageAccountPanel />
    </SidePanel>
  );
};

export default MobileAccountPanel;
