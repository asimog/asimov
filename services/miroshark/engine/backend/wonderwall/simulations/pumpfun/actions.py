"""Pump.fun agent actions: the tools the LLM can call (Asimog, docs/SLOW-MIND.md section 8.1). SIMULATED."""
from __future__ import annotations

from wonderwall.simulations.base import BaseAction


class PumpfunAction(BaseAction):
    """The nine Pump.fun actions of docs/SLOW-MIND.md, plus a portfolio view."""

    async def browse_callout_feed(self):
        """Read the latest callouts on Pump.fun: who called which coin, what they said, likes and replies.

        Returns:
            dict: {'success': True, 'callouts': [{'callout_id', 'caller_id', 'symbol', 'mint', 'content', 'likes', 'replies', 'observed'}]}
        """
        return await self.perform_action(None, "browse_callout_feed")

    async def view_coin(self, mint_or_symbol: str):
        """Open a coin page: price, bonding-curve progress, simulated traders and net SOL flow, your position.

        Args:
            mint_or_symbol (str): The coin's mint address or its symbol, for example 'PEPE'.

        Returns:
            dict: price_sol, curve_progress, sim_traders, sim_net_sol, your_tokens, your_cost_sol.
        """
        return await self.perform_action(mint_or_symbol, "view_coin")

    async def buy(self, mint_or_symbol: str, amount_sol: float):
        """Buy a coin on its bonding curve with SOL. Buying pushes the price up.

        Args:
            mint_or_symbol (str): The coin's mint address or symbol.
            amount_sol (float): SOL to spend (capped per trade).

        Returns:
            dict: tokens received, SOL spent and the price after the trade.
        """
        return await self.perform_action((mint_or_symbol, amount_sol), "buy")

    async def sell(self, mint_or_symbol: str, fraction: float):
        """Sell part or all of your position in a coin.

        Args:
            mint_or_symbol (str): The coin's mint address or symbol.
            fraction (float): Share of your position to sell, from 0.0 to 1.0.

        Returns:
            dict: SOL received and tokens sold.
        """
        return await self.perform_action((mint_or_symbol, fraction), "sell")

    async def post_callout(self, mint_or_symbol: str, content: str):
        """Post a public callout on a coin you hold (Pump.fun refuses callouts on coins you do not hold).

        Args:
            mint_or_symbol (str): The coin's mint address or symbol.
            content (str): The callout text, at most 280 characters.

        Returns:
            dict: the new callout_id, or an error if you hold none of the coin.
        """
        return await self.perform_action((mint_or_symbol, content), "post_callout")

    async def update_callout(self, callout_id: int, content: str):
        """Add an update to one of your own callouts (an exit, a new target, a warning).

        Args:
            callout_id (int): Your callout's id.
            content (str): The update text.
        """
        return await self.perform_action((callout_id, content), "update_callout")

    async def reply(self, callout_id: int, content: str):
        """Reply to a callout.

        Args:
            callout_id (int): The callout to reply to.
            content (str): Your reply, at most 280 characters.
        """
        return await self.perform_action((callout_id, content), "reply")

    async def follow_caller(self, caller_id: int):
        """Follow a caller to see more of their callouts.

        Args:
            caller_id (int): The caller's id from the feed.
        """
        return await self.perform_action(caller_id, "follow_caller")

    async def view_portfolio(self):
        """Your SOL balance and open positions with their current value."""
        return await self.perform_action(None, "view_portfolio")
