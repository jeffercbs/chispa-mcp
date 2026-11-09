export type Identity = {
	userId: string;
	clientId: string | null;
	token: string;
	expiresAt: number;
};
