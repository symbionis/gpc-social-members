export default function AdminLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-10 bg-border/50 rounded-lg w-48" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="h-28 bg-border/30 rounded-xl" />
        <div className="h-28 bg-border/30 rounded-xl" />
        <div className="h-28 bg-border/30 rounded-xl" />
      </div>
      <div className="h-64 bg-border/30 rounded-xl" />
    </div>
  );
}
