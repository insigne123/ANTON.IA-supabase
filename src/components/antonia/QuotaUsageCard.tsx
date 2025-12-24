'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { RefreshCw } from 'lucide-react';

interface QuotaData {
    searches: { used: number; limit: number; runs: number };
    enrichments: { used: number; limit: number };
    investigations: { used: number; limit: number };
    contacts: { used: number; limit: number };
    date: string;
}

export function QuotaUsageCard() {
    const [quota, setQuota] = useState<QuotaData | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchQuota = async () => {
        try {
            const res = await fetch('/api/antonia/quota');
            if (res.ok) {
                const data = await res.json();
                setQuota(data);
            }
        } catch (error) {
            console.error('Error fetching quota:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchQuota();
        // Auto-refresh every 30 seconds
        const interval = setInterval(fetchQuota, 30000);
        return () => clearInterval(interval);
    }, []);

    const getProgressColor = (percentage: number) => {
        if (percentage >= 90) return 'bg-red-500';
        if (percentage >= 70) return 'bg-yellow-500';
        return 'bg-green-500';
    };

    const QuotaItem = ({ label, used, limit }: { label: string; used: number; limit: number }) => {
        const percentage = limit > 0 ? (used / limit) * 100 : 0;
        const colorClass = getProgressColor(percentage);

        return (
            <div className=\"space-y-2\">
                < div className =\"flex justify-between text-sm\">
                    < span className =\"font-medium\">{label}</span>
                        < span className =\"text-muted-foreground\">
        { used }/{limit} ({Math.round(percentage)}%)
          </span >
        </div >
        <div className=\"relative\">
            < Progress value = { percentage } className =\"h-2\" />
                < div
    className = {`absolute top-0 left-0 h-2 rounded-full transition-all ${colorClass}`
}
style = {{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div >
      </div >
    );
  };

if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Uso de Cuotas Diarias</CardTitle>
        </CardHeader>
        <CardContent>
          <div className=\"animate-pulse space-y-4\">
            <div className=\"h-4 bg-gray-200 rounded\"></div>
            <div className=\"h-4 bg-gray-200 rounded\"></div>
            <div className=\"h-4 bg-gray-200 rounded\"></div>
          </div >
        </CardContent >
      </Card >
    );
}

if (!quota) {
    return null;
}

return (
    <Card>
        <CardHeader>
            <div className=\"flex justify-between items-start\">
            <div>
                <CardTitle>Uso de Cuotas Diarias</CardTitle>
                <CardDescription>
                    Se reinicia a medianoche • {new Date(quota.date).toLocaleDateString()}
                </CardDescription>
            </div>
            <button
                onClick={fetchQuota}
                className=\"p-2 hover:bg-gray-100 rounded-md transition-colors\"
            title=\"Actualizar\"
          >
            <RefreshCw className=\"h-4 w-4\" />
        </button>
    </div>
      </CardHeader >
    <CardContent className=\"space-y-4\">
        < QuotaItem
label =\"Búsquedas\" 
used = { quota.searches.runs }
limit = { 10}
    />
    <QuotaItem
        label=\"Enriquecimientos\" 
used = { quota.enrichments.used }
limit = { quota.enrichments.limit }
    />
    <QuotaItem
        label=\"Investigaciones\" 
used = { quota.investigations.used }
limit = { quota.investigations.limit }
    />
    <QuotaItem
        label=\"Contactos\" 
used = { quota.contacts.used }
limit = { quota.contacts.limit }
    />
      </CardContent >
    </Card >
  );
}
