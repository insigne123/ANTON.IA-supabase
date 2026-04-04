
import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from 'lucide-react';

interface ReportViewerProps {
    isOpen: boolean;
    onClose: () => void;
    report: {
        id: string;
        type: string;
        content: string; // HTML
        createdAt: string;
    } | null;
}

export const ReportViewer: React.FC<ReportViewerProps> = ({ isOpen, onClose, report }) => {
    if (!report) return null;

    const handleDownload = () => {
        const element = document.createElement("a");
        const file = new Blob([report.content], { type: 'text/html' });
        element.href = URL.createObjectURL(file);
        element.download = `report-${report.id}.html`;
        document.body.appendChild(element); // Required for this to work in FireFox
        element.click();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
                <DialogHeader className="p-4 border-b flex flex-row items-center justify-between">
                    <DialogTitle>
                        Reporte {report.type === 'mission_historic' ? 'de Misión' : 'Diario'} - {new Date(report.createdAt).toLocaleDateString()}
                    </DialogTitle>
                    <Button variant="outline" size="sm" onClick={handleDownload}>
                        <Download className="w-4 h-4 mr-2" /> Descargar HTML
                    </Button>
                </DialogHeader>
                <div className="flex-1 bg-gray-50 overflow-hidden relative">
                    <iframe
                        srcDoc={report.content}
                        className="w-full h-full border-none"
                        title="Report Content"
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
};
