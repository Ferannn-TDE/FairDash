import VendorPortalShell from './_components/VendorPortalShell'

interface Props {
  params: { fairSlug: string }
  children: React.ReactNode
}

// Mock vendor/user data — swap for real API/session calls when backend is ready
const mockVendorMeta = {
  vendorName: 'Smoky Barrel BBQ',
  userName: 'Feran',
  userEmail: 'feranmidyro@gmail.com',
}

export default function VendorFairLayout({ params, children }: Props) {
  return (
    <VendorPortalShell
      fairSlug={params.fairSlug}
      vendorName={mockVendorMeta.vendorName}
      userName={mockVendorMeta.userName}
      userEmail={mockVendorMeta.userEmail}
    >
      {children}
    </VendorPortalShell>
  )
}
