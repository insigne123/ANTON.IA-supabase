'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { commentsService } from '@/lib/services/comments-service';
import { Comment } from '@/lib/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Loader2, Send, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface CommentsSectionProps {
    entityType: 'lead' | 'campaign';
    entityId: string;
}

export function CommentsSection({ entityType, entityId }: CommentsSectionProps) {
    const { user } = useAuth();
    const { toast } = useToast();
    const [comments, setComments] = useState<Comment[]>([]);
    const [newComment, setNewComment] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const fetchComments = async () => {
        try {
            const data = await commentsService.getComments(entityType, entityId);
            setComments(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchComments();

        // Realtime subscription
        const channel = supabase
            .channel(`comments:${entityId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'comments',
                    filter: `entity_id=eq.${entityId}`,
                },
                () => {
                    fetchComments();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [entityId, entityType]);

    useEffect(() => {
        // Scroll to bottom on new comments
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [comments]);

    const handleSend = async () => {
        if (!newComment.trim()) return;
        setSending(true);
        try {
            await commentsService.addComment(entityType, entityId, newComment);
            setNewComment('');
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'No se pudo enviar el comentario.',
            });
        } finally {
            setSending(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('¿Borrar comentario?')) return;
        try {
            await commentsService.deleteComment(id);
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'No se pudo borrar el comentario.',
            });
        }
    };

    if (loading) return <div className="flex justify-center p-4"><Loader2 className="animate-spin h-6 w-6 text-muted-foreground" /></div>;

    return (
        <div className="flex flex-col h-full max-h-[600px] border rounded-lg bg-background shadow-sm">
            <div className="p-4 border-b bg-muted/30">
                <h3 className="font-semibold flex items-center gap-2">
                    Comentarios <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{comments.length}</span>
                </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
                {comments.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8 text-sm">
                        No hay comentarios aún. Sé el primero en escribir algo.
                    </div>
                ) : (
                    comments.map((comment) => (
                        <div key={comment.id} className="flex gap-3 group">
                            <Avatar className="h-8 w-8 mt-1">
                                <AvatarImage src={comment.user?.avatarUrl} />
                                <AvatarFallback>{comment.user?.fullName?.[0] || '?'}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 space-y-1">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium">{comment.user?.fullName}</span>
                                        <span className="text-xs text-muted-foreground">
                                            {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: es })}
                                        </span>
                                    </div>
                                    {user?.id === comment.userId && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={() => handleDelete(comment.id)}
                                        >
                                            <Trash2 className="h-3 w-3 text-destructive" />
                                        </Button>
                                    )}
                                </div>
                                <div className="text-sm text-foreground/90 whitespace-pre-wrap bg-muted/50 p-3 rounded-md rounded-tl-none">
                                    {comment.content}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="p-4 border-t bg-background">
                <div className="flex gap-2">
                    <Textarea
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Escribe un comentario..."
                        className="min-h-[80px] resize-none"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                    />
                    <Button
                        size="icon"
                        className="h-[80px] w-12 shrink-0"
                        onClick={handleSend}
                        disabled={sending || !newComment.trim()}
                    >
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 text-right">
                    Presiona Enter para enviar
                </p>
            </div>
        </div>
    );
}
