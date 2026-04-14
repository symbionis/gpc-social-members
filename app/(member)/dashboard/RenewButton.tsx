import Link from "next/link";

export default function RenewButton() {
  return (
    <div className="mt-4">
      <Link
        href="/renew"
        className="block w-full py-2.5 bg-marine text-white rounded-lg font-body font-medium text-sm hover:bg-marine-light transition-colors text-center"
      >
        Renew Membership
      </Link>
    </div>
  );
}
