
import React, { useState } from 'react';
import { Send, MessageSquare, Mail, User, CheckCircle } from 'lucide-react';
import { Card, Button, Input } from '../components/ui';
import { FirebaseService } from '../services/firebaseService';

export const Contact: React.FC = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !message) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await FirebaseService.saveFeedback({
        name,
        email,
        message,
        timestamp: new Date().toISOString(),
      });
      setIsSuccess(true);
      setName('');
      setEmail('');
      setMessage('');
    } catch (err: any) {
      console.error(err);
      setError('Failed to send message. Please try again later.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-white mb-4 tracking-tight">Contact & Feedback</h1>
        <p className="text-slate-400 text-lg">
          Have a question, suggestion, or found a bug? We'd love to hear from you.
        </p>
      </div>

      {isSuccess ? (
        <Card className="bg-emerald-900/10 border-emerald-500/30 text-center py-12">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Message Sent!</h2>
          <p className="text-slate-400 mb-6">
            Thank you for your feedback. We'll get back to you as soon as possible.
          </p>
          <Button onClick={() => setIsSuccess(false)}>Send Another Message</Button>
        </Card>
      ) : (
        <Card className="bg-slate-900/50 border-slate-800">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Input
                label="Your Name"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                icon={User}
              />
              <Input
                label="Email Address"
                type="email"
                placeholder="john@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                icon={Mail}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                Message
              </label>
              <div className="relative">
                <div className="absolute top-3 left-4 text-slate-500">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <textarea
                  className="w-full bg-slate-900/50 border border-slate-700 rounded-lg pl-11 pr-4 py-2.5 text-slate-200 placeholder-slate-500 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none transition-colors min-h-[150px] resize-none"
                  placeholder="Tell us what's on your mind..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                />
              </div>
            </div>

            {error && (
              <p className="text-red-400 text-sm bg-red-900/10 border border-red-500/20 p-3 rounded-lg">
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="w-full py-3"
              isLoading={isSubmitting}
              icon={Send}
              disabled={!name || !email || !message}
            >
              Send Message
            </Button>
          </form>
        </Card>
      )}

      <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="flex items-start space-x-4 p-4 rounded-xl bg-slate-900/30 border border-slate-800/50">
          <div className="w-10 h-10 bg-brand-500/10 rounded-lg flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h4 className="text-white font-semibold mb-1">Direct Email</h4>
            <p className="text-sm text-slate-500">brainiacgoatdev@gmail.com</p>
          </div>
        </div>
        <div className="flex items-start space-x-4 p-4 rounded-xl bg-slate-900/30 border border-slate-800/50">
          <div className="w-10 h-10 bg-brand-500/10 rounded-lg flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h4 className="text-white font-semibold mb-1">Community</h4>
            <p className="text-sm text-slate-500">Join the Perchance forums</p>
          </div>
        </div>
      </div>
    </div>
  );
};
