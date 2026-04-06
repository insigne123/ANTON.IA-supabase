
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Eye, Loader2 } from 'lucide-react';
import { Badge } from "@/components/ui/badge";

interface ReportsHistoryProps {
    reports: any[];
    loading: boolean;
    onView: (report: any) => void;
}

export const ReportsHistory: React.FC<ReportsHistoryProps> = ({ reports, loading, onView }) => {
    return (
        <Card className="h-full border-t-0 rounded-t-none shadow-none sm:border sm:rounded-lg sm:shadow-sm">
            <CardHeader>
                <CardTitle className="text-lg font-medium flex items-center gap-2">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                    Historial de Reportes
                </CardTitle>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                ) : reports.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                        No hay reportes generados aún.
                    </div>
                ) : (
                    <div className="space-y-4">
                        {reports.map((report) => (
                            <div
                                key={report.id}
                                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                            >
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <Badge variant={report.type === 'daily' ? 'default' : 'secondary'}>
                                            {report.type === 'daily' ? 'Diario' :
                                                report.type === 'weekly' ? 'Semanal' : 'Misión'}
                                        </Badge>
                                        <span className="text-sm font-medium">
                                            {new Date(report.createdAt).toLocaleDateString()} {new Date(report.createdAt).toLocaleTimeString()}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate max-w-[300px]">
                                        {report.missionId ? `Misión ID: ${report.missionId.substring(0, 8)}...` : 'Reporte general de actividad'}
                                    </p>
                                </div>
                                <Button size="sm" variant="ghost" onClick={() => onView(report)}>
                                    <Eye className="w-4 h-4 mr-2" /> Ver
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
