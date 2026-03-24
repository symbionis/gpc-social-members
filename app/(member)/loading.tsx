export default function MemberLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-10 bg-border/50 rounded-lg w-64" />
      <div className="h-5 bg-border/30 rounded w-96" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="h-48 bg-border/30 rounded-xl" />
        <div className="h-48 bg-border/30 rounded-xl" />
      </div>
    </div>
  );
}
