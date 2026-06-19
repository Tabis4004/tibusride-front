// OAuth Lovable désactivé — auth email/mot de passe via Vercel Postgres.
export const lovable = {
  auth: {
    signInWithOAuth: async () => ({
      error: new Error("Connexion Google indisponible. Utilisez email et mot de passe."),
    }),
  },
};
