"""Pump.fun swarm simulation for Wonderwall (Asimog, docs/SLOW-MIND.md section 8). SIMULATED.

Usage::

    from wonderwall.simulations.pumpfun import pumpfun_simulation

    env = wonderwall.make(agent_graph=graph, simulation=pumpfun_simulation, database_path="./data/pumpfun.db")
"""
from wonderwall.simulations.base import SimulationConfig
from wonderwall.simulations.pumpfun.actions import PumpfunAction
from wonderwall.simulations.pumpfun.environment import PumpfunEnvironment
from wonderwall.simulations.pumpfun.platform import PumpfunPlatform
from wonderwall.simulations.pumpfun.prompts import ARCHETYPES, PumpfunPromptBuilder

pumpfun_simulation = SimulationConfig(
    name="pumpfun",
    platform_cls=PumpfunPlatform,
    action_cls=PumpfunAction,
    environment_cls=PumpfunEnvironment,
    prompt_builder=PumpfunPromptBuilder(),
    default_actions=["browse_callout_feed", "view_coin", "buy", "sell", "post_callout", "update_callout", "reply", "follow_caller", "do_nothing"],
    platform_kwargs={"initial_sol": 1.0, "max_buy_sol": 0.5},
)

__all__ = ["pumpfun_simulation", "PumpfunPlatform", "PumpfunAction", "PumpfunEnvironment", "PumpfunPromptBuilder", "ARCHETYPES"]
